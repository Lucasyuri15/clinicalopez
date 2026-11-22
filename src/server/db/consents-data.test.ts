import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ConsentInput } from "@/lib/patients/consents";
import { listConsents, patientsLackingDataConsent } from "@/server/patients/consent-queries";
import { registerConsent } from "@/server/patients/consent-mutations";
import { listPatients } from "@/server/patients/queries";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Camada de dados dos consentimentos contra o Supabase DEV pelo caminho REAL do app
 * (`DATABASE_URL` → `app_backend` → `authenticated` sob RLS, via `withUser`). Só dados FICTÍCIOS.
 * Fixtures commitados pelo dono e apagados no fim (o código usa outra conexão). Quem vê o quê é da
 * RLS (`patient-consents-rls.test.ts`); aqui se prova que consultas e gravações a respeitam de
 * ponta a ponta e que o estado atual segue a data real do consentimento.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-cons ${randomUUID().slice(0, 8)}]`;

const event = (patientId: string, over: Partial<ConsentInput> = {}): ConsentInput => ({
  patientId,
  kind: "data_processing",
  granted: true,
  givenBy: "patient",
  method: "signed_paper",
  occurredOn: "2026-11-01",
  note: null,
  ...over,
});

describe.skipIf(!hasDb)("camada de dados de consentimentos (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = {
    admin: { userId: randomUUID() },
    reception: { userId: randomUUID() },
    prof: { userId: randomUUID() },
  };
  const patientIds = { linked: "", other: "", removed: "", fresh: "" };

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`cons-${key}-${userId}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role) values
        (${users.admin.userId}, ${`${TAG} Admin`}, 'admin'),
        (${users.reception.userId}, ${`${TAG} Recepcao`}, 'reception'),
        (${users.prof.userId}, ${`${TAG} Login Prof`}, 'professional')`;
      const [prof] = await owner`insert into public.professionals (full_name, specialty, profile_id)
        values (${`${TAG} Ana`}, 'physiotherapy', ${users.prof.userId}) returning id`;
      const rows = await owner`insert into public.patients (full_name, birth_date, deleted_at) values
        (${`${TAG} Vinculado`}, '1990-05-10', null),
        (${`${TAG} Outro`}, '1985-03-02', null),
        (${`${TAG} Removido`}, '1999-09-09', now()),
        (${`${TAG} Novo`}, '2001-12-31', null) returning id`;
      patientIds.linked = rows[0]!.id;
      patientIds.other = rows[1]!.id;
      patientIds.removed = rows[2]!.id;
      patientIds.fresh = rows[3]!.id;
      await owner`insert into public.patient_professionals (patient_id, professional_id)
        values (${patientIds.linked}, ${prof!.id})`;
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  async function cleanup() {
    const like = `${TAG}%`;
    // Consentimentos primeiro: referenciam pacientes e perfis (FK restrict).
    await owner`delete from public.patient_consents where patient_id in
      (select id from public.patients where full_name like ${like})`;
    await owner`delete from public.patient_professionals where patient_id in
      (select id from public.patients where full_name like ${like})`;
    await owner`delete from public.patients where full_name like ${like}`;
    await owner`delete from public.professionals where full_name like ${like}`;
    const all = Object.values(users).map((u) => u.userId);
    await owner`delete from public.profiles where id = any(${all})`;
    await owner`delete from auth.users where id = any(${all})`;
  }

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await owner.end({ timeout: 5 });
    }
  });

  describe("registerConsent", () => {
    it("admin e recepção registram e o histórico traz o registro (mais recente primeiro)", async () => {
      const first = await registerConsent(users.admin, event(patientIds.linked, { occurredOn: "2026-10-01" }));
      const second = await registerConsent(
        users.reception,
        event(patientIds.linked, { kind: "whatsapp", method: "verbal", givenBy: "guardian", occurredOn: "2026-11-10", note: "Pelo telefone" }),
      );
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);

      const history = await listConsents(users.admin, patientIds.linked);
      expect(history.map((item) => item.occurredOn)).toEqual(["2026-11-10", "2026-10-01"]);
      expect(history[0]).toMatchObject({
        kind: "whatsapp",
        granted: true,
        givenBy: "guardian",
        method: "verbal",
        note: "Pelo telefone",
        registeredByName: `${TAG} Recepcao`,
      });
      expect(history[0]!.createdAt).toBeInstanceOf(Date);
    });

    it("quem registrou vem do usuário da sessão, nunca de um campo do pedido", async () => {
      await registerConsent(users.reception, event(patientIds.other, { occurredOn: "2026-02-02" }));
      const rows = await owner`select registered_by from public.patient_consents
        where patient_id = ${patientIds.other} and occurred_on = '2026-02-02'`;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.registered_by).toBe(users.reception.userId);
    });

    it("o profissional não registra (denied), nem para paciente vinculado a ele", async () => {
      expect(await registerConsent(users.prof, event(patientIds.linked))).toEqual({ ok: false, reason: "denied" });
    });

    it("paciente removido ou inexistente: denied, sem texto do banco", async () => {
      expect(await registerConsent(users.admin, event(patientIds.removed))).toEqual({ ok: false, reason: "denied" });
      expect(await registerConsent(users.reception, event(patientIds.removed))).toEqual({ ok: false, reason: "denied" });
      expect(await registerConsent(users.admin, event(randomUUID()))).toEqual({ ok: false, reason: "denied" });
    });

    it("dado inválido para o banco vira denied, não exceção (data fora de 1900-2100, nota com espaço nas pontas)", async () => {
      expect(await registerConsent(users.admin, event(patientIds.linked, { occurredOn: "1800-01-01" }))).toEqual({ ok: false, reason: "denied" });
      expect(await registerConsent(users.admin, event(patientIds.linked, { note: " com espaço " }))).toEqual({ ok: false, reason: "denied" });
    });
  });

  describe("listConsents", () => {
    it("o profissional não vê nada, nem do paciente vinculado a ele", async () => {
      await registerConsent(users.admin, event(patientIds.linked, { occurredOn: "2026-09-09" }));
      expect(await listConsents(users.prof, patientIds.linked)).toEqual([]);
    });

    it("UUID inválido devolve lista vazia, sem consultar o banco", async () => {
      expect(await listConsents(users.admin, "não-é-uuid")).toEqual([]);
    });

    it("a recepção não lê o nome de quem é de outro usuário (a RLS de profiles), mas lê o próprio", async () => {
      await registerConsent(users.admin, event(patientIds.fresh, { occurredOn: "2026-03-03" }));
      await registerConsent(users.reception, event(patientIds.fresh, { granted: false, occurredOn: "2026-04-04" }));
      const history = await listConsents(users.reception, patientIds.fresh);
      const names = Object.fromEntries(history.map((item) => [item.occurredOn, item.registeredByName]));
      expect(names["2026-04-04"]).toBe(`${TAG} Recepcao`);
      expect(names["2026-03-03"]).toBeNull();
    });

    it("o admin não vê o histórico de paciente removido pela tela, mas a consulta o devolve (a RLS deixa)", async () => {
      await owner`insert into public.patient_consents (patient_id, kind, granted, given_by, method, occurred_on, registered_by)
        values (${patientIds.removed}, 'data_processing', true, 'patient', 'verbal', '2026-01-01', ${users.admin.userId})`;
      expect(await listConsents(users.admin, patientIds.removed)).toHaveLength(1);
      expect(await listConsents(users.reception, patientIds.removed)).toEqual([]);
    });
  });

  describe("patientsLackingDataConsent", () => {
    it("sem registro ou revogado = falta; concedido = ok; o WhatsApp não vale pelo tratamento; segue a data real", async () => {
      const created = await owner`insert into public.patients (full_name, birth_date) values
        (${`${TAG} Concedeu`}, '1980-01-01'),
        (${`${TAG} Revogou`}, '1980-01-02'),
        (${`${TAG} Sem registro`}, '1980-01-03'),
        (${`${TAG} So WhatsApp`}, '1980-01-04'),
        (${`${TAG} Registro tardio`}, '1980-01-05') returning id`;
      const [granted, revoked, none, onlyWhatsapp, late] = created.map((row) => row.id as string) as [
        string, string, string, string, string,
      ];

      await registerConsent(users.admin, event(granted, { occurredOn: "2026-03-03" }));
      await registerConsent(users.admin, event(revoked, { occurredOn: "2026-03-03" }));
      await registerConsent(users.reception, event(revoked, { granted: false, occurredOn: "2026-04-04" }));
      await registerConsent(users.admin, event(onlyWhatsapp, { kind: "whatsapp", occurredOn: "2026-03-03" }));
      // Concessão de fevereiro registrada primeiro; revogação de janeiro registrada DEPOIS: vale a data real.
      await registerConsent(users.admin, event(late, { occurredOn: "2026-02-01" }));
      await registerConsent(users.reception, event(late, { granted: false, occurredOn: "2026-01-01" }));

      const ids = [granted, revoked, none, onlyWhatsapp, late];
      for (const user of [users.admin, users.reception]) {
        const lacking = await patientsLackingDataConsent(user, ids, { staff: true });
        expect([...lacking].sort()).toEqual([revoked, none, onlyWhatsapp].sort());
      }
    });

    it("o profissional nunca recebe o aviso (staff: false não consulta, e a RLS esconderia tudo)", async () => {
      expect(await patientsLackingDataConsent(users.prof, [patientIds.linked], { staff: false })).toEqual([]);
    });

    it("lista vazia não vai ao banco", async () => {
      expect(await patientsLackingDataConsent(users.admin, [], { staff: true })).toEqual([]);
    });
  });

  describe("listPatients traz o aviso na mesma consulta", () => {
    it("staff recebe lacksDataConsent em cada paciente; sem staff o campo nem existe", async () => {
      const created = await owner`insert into public.patients (full_name, birth_date) values
        (${`${TAG} Aviso Com`}, '1975-01-01'),
        (${`${TAG} Aviso Sem`}, '1975-01-02') returning id, full_name`;
      const withConsent = created.find((row) => String(row.full_name).endsWith("Aviso Com"))!.id as string;
      await registerConsent(users.admin, event(withConsent, { occurredOn: "2026-05-05" }));

      const search = `${TAG} Aviso`;
      for (const user of [users.admin, users.reception]) {
        const { items } = await listPatients(user, { search, staff: true });
        expect(items.map((item) => [item.fullName, item.lacksDataConsent])).toEqual([
          [`${TAG} Aviso Com`, false],
          [`${TAG} Aviso Sem`, true],
        ]);
      }

      const plain = await listPatients(users.reception, { search, staff: false });
      expect(plain.items).toHaveLength(2);
      for (const item of plain.items) expect(item).not.toHaveProperty("lacksDataConsent");
      const omitted = await listPatients(users.reception, { search });
      for (const item of omitted.items) expect(item).not.toHaveProperty("lacksDataConsent");
    });
  });
});
