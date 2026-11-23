import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { addEntry, removeEntry, updateEntry } from "@/server/waitlist/mutations";
import { listWaitlist } from "@/server/waitlist/queries";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Camada de dados da lista de espera (Fase 3B, cadastro) contra o Supabase DEV pelo caminho REAL do
 * app (`DATABASE_URL` → `app_backend` → `authenticated` sob RLS, via `withUser`). Só dados FICTÍCIOS.
 * Fixtures commitados pelo dono e apagados no fim. A RLS em si está em `waitlist-rls*.test.ts`; aqui
 * se prova que pôr, editar e tirar da espera conferem serviço, profissional e paciente, devolvem um
 * VALOR (nunca o erro do banco) e que a lista sai na ordem certa, só com o que cada estado mostra.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-espera ${randomUUID().slice(0, 8)}]`;

describe.skipIf(!hasDb)("camada de dados da lista de espera: cadastro (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = {
    admin: { userId: randomUUID() },
    reception: { userId: randomUUID() },
    profA: { userId: randomUUID() },
  };
  const ids = { pA: "", pB: "", pInactive: "", svc: "", svc2: "", svcInactive: "", p1: "", p2: "", p3: "", pRemoved: "" };

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`espera-${key}-${userId}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role) values
        (${users.admin.userId}, ${`${TAG} Admin`}, 'admin'),
        (${users.reception.userId}, ${`${TAG} Recepcao`}, 'reception'),
        (${users.profA.userId}, ${`${TAG} Login A`}, 'professional')`;
      const pros = await owner`insert into public.professionals (full_name, specialty, profile_id, active) values
        (${`${TAG} Ana`}, 'physiotherapy', ${users.profA.userId}, true),
        (${`${TAG} Bia`}, 'physiotherapy', null, true),
        (${`${TAG} Inativa`}, 'physiotherapy', null, false) returning id`;
      [ids.pA, ids.pB, ids.pInactive] = pros.map((row) => row.id as string) as [string, string, string];
      const svcs = await owner`insert into public.services (name, specialty, duration_minutes, active) values
        (${`${TAG} Sessao`}, 'physiotherapy', 50, true),
        (${`${TAG} Avaliacao`}, 'physiotherapy', 60, true),
        (${`${TAG} Inativo`}, 'physiotherapy', 30, false) returning id`;
      [ids.svc, ids.svc2, ids.svcInactive] = svcs.map((row) => row.id as string) as [string, string, string];
      // Ana e a Inativa oferecem a Sessão; a Bia não oferece nenhum serviço.
      await owner`insert into public.professional_services (professional_id, service_id, specialty) values
        (${ids.pA}, ${ids.svc}, 'physiotherapy'), (${ids.pA}, ${ids.svc2}, 'physiotherapy'),
        (${ids.pInactive}, ${ids.svc}, 'physiotherapy')`;
      const pats = await owner`insert into public.patients (full_name, birth_date, deleted_at) values
        (${`${TAG} Paciente 1`}, '1990-05-10', null), (${`${TAG} Paciente 2`}, '1985-03-02', null),
        (${`${TAG} Paciente 3`}, '2001-12-31', null), (${`${TAG} Paciente Removido`}, '1999-09-09', now()) returning id`;
      [ids.p1, ids.p2, ids.p3, ids.pRemoved] = pats.map((row) => row.id as string) as [string, string, string, string];
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  async function cleanup() {
    const like = `${TAG}%`;
    const patientIds = owner`select id from public.patients where full_name like ${like}`;
    await owner`delete from public.waitlist_entries where patient_id in (${patientIds})`;
    await owner`delete from public.patients where full_name like ${like}`;
    const proIds = owner`select id from public.professionals where full_name like ${like}`;
    await owner`delete from public.professional_services where professional_id in (${proIds})`;
    await owner`delete from public.professionals where full_name like ${like}`;
    await owner`delete from public.services where name like ${like}`;
    const all = Object.values(users).map((u) => u.userId);
    await owner`delete from public.profiles where id = any(${all})`;
    await owner`delete from auth.users where id = any(${all})`;
  }

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await owner?.end({ timeout: 2 });
    }
  });

  beforeEach(async () => {
    await owner`delete from public.waitlist_entries where patient_id in
      (select id from public.patients where full_name like ${`${TAG}%`})`;
  });

  const input = (over: Record<string, unknown> = {}) => ({
    patientId: ids.p1,
    serviceId: ids.svc,
    professionalId: null as string | null,
    weekdays: [] as number[],
    startMinute: null as number | null,
    endMinute: null as number | null,
    note: null as string | null,
    ...over,
  });
  const rowOf = async (id: string) => (await owner`select * from public.waitlist_entries where id = ${id}`)[0];

  describe("addEntry", () => {
    it.each(["admin", "reception"] as const)("%s põe na espera: qualquer profissional, dia e horário", async (who) => {
      const result = await addEntry(users[who], input());
      expect(result.ok).toBe(true);
      const saved = await rowOf((result as { id: string }).id);
      expect(saved).toMatchObject({
        patient_id: ids.p1,
        service_id: ids.svc,
        professional_id: null,
        specialty: "physiotherapy",
        status: "waiting",
        created_by: users[who].userId,
      });
      expect(saved?.weekdays).toEqual([]);
    });

    it("grava a preferência completa e o profissional que oferece o serviço", async () => {
      const result = await addEntry(
        users.reception,
        input({ professionalId: ids.pA, weekdays: [1, 3], startMinute: 840, endMinute: 1080, note: "[teste] tarde" }),
      );
      expect(result.ok).toBe(true);
      expect(await rowOf((result as { id: string }).id)).toMatchObject({
        professional_id: ids.pA,
        weekdays: [1, 3],
        start_minute: 840,
        end_minute: 1080,
        note: "[teste] tarde",
      });
    });

    it("recusa profissional que não oferece o serviço (service-not-offered)", async () => {
      expect(await addEntry(users.admin, input({ professionalId: ids.pB }))).toEqual({ ok: false, reason: "service-not-offered" });
      // A Ana oferece a Sessão e a Avaliação; nada impede, mas o serviço inativo nunca entra:
      expect(await addEntry(users.admin, input({ serviceId: ids.svcInactive, professionalId: ids.pA }))).toEqual({
        ok: false,
        reason: "not-found",
      });
    });

    it("recusa profissional inativo, paciente removido e serviço inexistente ou inativo (not-found)", async () => {
      expect(await addEntry(users.admin, input({ professionalId: ids.pInactive }))).toEqual({ ok: false, reason: "not-found" });
      expect(await addEntry(users.admin, input({ patientId: ids.pRemoved }))).toEqual({ ok: false, reason: "not-found" });
      expect(await addEntry(users.admin, input({ serviceId: ids.svcInactive }))).toEqual({ ok: false, reason: "not-found" });
      expect(await addEntry(users.admin, input({ serviceId: randomUUID() }))).toEqual({ ok: false, reason: "not-found" });
      expect(await addEntry(users.admin, input({ patientId: randomUUID() }))).toEqual({ ok: false, reason: "not-found" });
    });

    it("o profissional (login) não põe ninguém na espera, e nada é gravado", async () => {
      // A RLS esconde o paciente não vinculado a ele (not-found) antes de chegar à política de INSERT.
      expect((await addEntry(users.profA, input())).ok).toBe(false);
      const [count] = await owner`select count(*)::int as n from public.waitlist_entries where patient_id = ${ids.p1}`;
      expect(count?.n).toBe(0);
    });

    it("uma espera aberta por paciente + serviço + profissional (duplicate); outro profissional ou 'qualquer' é outra", async () => {
      expect((await addEntry(users.reception, input({ professionalId: ids.pA }))).ok).toBe(true);
      expect(await addEntry(users.reception, input({ professionalId: ids.pA }))).toEqual({ ok: false, reason: "duplicate" });
      expect((await addEntry(users.reception, input())).ok).toBe(true);
      expect(await addEntry(users.reception, input())).toEqual({ ok: false, reason: "duplicate" });
      expect((await addEntry(users.reception, input({ serviceId: ids.svc2 }))).ok).toBe(true);
    });

    it("dois pedidos iguais ao mesmo tempo: um entra e o outro volta duplicate", async () => {
      const results = await Promise.all([addEntry(users.reception, input({ patientId: ids.p2 })), addEntry(users.admin, input({ patientId: ids.p2 }))]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, reason: "duplicate" }]);
      const [count] = await owner`select count(*)::int as n from public.waitlist_entries where patient_id = ${ids.p2}`;
      expect(count?.n).toBe(1);
    });

    it("preferência que o banco recusa vira denied, sem repetir o que foi digitado", async () => {
      const result = await addEntry(users.admin, input({ weekdays: [9], note: "SEGREDO-DE-SAUDE" }));
      expect(result).toEqual({ ok: false, reason: "denied" });
      expect(JSON.stringify(result)).not.toContain("SEGREDO");
    });
  });

  describe("updateEntry", () => {
    const edit = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      professionalId: null as string | null,
      weekdays: [] as number[],
      startMinute: null as number | null,
      endMinute: null as number | null,
      note: null as string | null,
      ...over,
    });

    it.each(["admin", "reception"] as const)("%s edita profissional, dias, faixa e nota", async (who) => {
      const { id } = (await addEntry(users.admin, input())) as { id: string };
      const result = await updateEntry(users[who], edit(id, { professionalId: ids.pA, weekdays: [5], startMinute: 480, endMinute: 600, note: "[teste] x" }));
      expect(result).toEqual({ ok: true, id });
      expect(await rowOf(id)).toMatchObject({ professional_id: ids.pA, weekdays: [5], start_minute: 480, end_minute: 600, note: "[teste] x", status: "waiting" });
    });

    it("limpar a preferência volta para 'qualquer' (profissional, dias, faixa e nota nulos)", async () => {
      const { id } = (await addEntry(users.admin, input({ professionalId: ids.pA, weekdays: [1], startMinute: 480, endMinute: 600, note: "[teste] y" }))) as { id: string };
      expect((await updateEntry(users.admin, edit(id))).ok).toBe(true);
      expect(await rowOf(id)).toMatchObject({ professional_id: null, weekdays: [], start_minute: null, end_minute: null, note: null });
    });

    it("confere o profissional novo: que não oferece o serviço (service-not-offered) e o inativo (not-found)", async () => {
      const { id } = (await addEntry(users.admin, input())) as { id: string };
      expect(await updateEntry(users.admin, edit(id, { professionalId: ids.pB }))).toEqual({ ok: false, reason: "service-not-offered" });
      expect(await updateEntry(users.admin, edit(id, { professionalId: ids.pInactive }))).toEqual({ ok: false, reason: "not-found" });
    });

    it("manter o profissional (já inativo ou que deixou de oferecer o serviço) não impede editar a nota", async () => {
      const { id } = (await addEntry(users.admin, input({ professionalId: ids.pA }))) as { id: string };
      // A Ana é desativada depois do cadastro da espera.
      await owner`update public.professionals set active = false where id = ${ids.pA}`;
      try {
        const result = await updateEntry(users.reception, edit(id, { professionalId: ids.pA, weekdays: [2], note: "[teste] ajuste" }));
        expect(result).toEqual({ ok: true, id });
        expect(await rowOf(id)).toMatchObject({ professional_id: ids.pA, weekdays: [2], note: "[teste] ajuste" });
        // Trocar PARA ela agora (inativa) continua recusado: só vale manter.
        const other = (await addEntry(users.admin, input({ patientId: ids.p2 }))) as { id: string };
        expect(await updateEntry(users.admin, edit(other.id, { professionalId: ids.pA }))).toEqual({ ok: false, reason: "not-found" });
      } finally {
        await owner`update public.professionals set active = true where id = ${ids.pA}`;
      }
    });

    it("editar para um profissional que já tem outra espera aberta do mesmo paciente e serviço é duplicate", async () => {
      await addEntry(users.admin, input({ professionalId: ids.pA }));
      const { id } = (await addEntry(users.admin, input())) as { id: string };
      expect(await updateEntry(users.admin, edit(id, { professionalId: ids.pA }))).toEqual({ ok: false, reason: "duplicate" });
    });

    it("espera inexistente é not-found; encerrada é changed", async () => {
      expect(await updateEntry(users.admin, edit(randomUUID()))).toEqual({ ok: false, reason: "not-found" });
      const { id } = (await addEntry(users.admin, input())) as { id: string };
      await removeEntry(users.admin, { id });
      expect(await updateEntry(users.admin, edit(id, { note: "[teste] z" }))).toEqual({ ok: false, reason: "changed" });
    });

    it("o profissional (login) não edita (not-found: a RLS esconde a espera)", async () => {
      const { id } = (await addEntry(users.admin, input())) as { id: string };
      expect(await updateEntry(users.profA, edit(id, { note: "[teste] w" }))).toEqual({ ok: false, reason: "not-found" });
      expect((await rowOf(id))?.note).toBeNull();
    });

    it("preferência que o banco recusa vira denied", async () => {
      const { id } = (await addEntry(users.admin, input())) as { id: string };
      expect(await updateEntry(users.admin, edit(id, { weekdays: [9] }))).toEqual({ ok: false, reason: "denied" });
    });
  });

  describe("removeEntry", () => {
    it.each(["admin", "reception"] as const)("%s tira da espera; quem e quando ficam registrados", async (who) => {
      const { id } = (await addEntry(users.admin, input())) as { id: string };
      expect(await removeEntry(users[who], { id })).toEqual({ ok: true, id });
      expect(await rowOf(id)).toMatchObject({ status: "removed", closed_by: users[who].userId });
      expect((await rowOf(id))?.closed_at).toBeInstanceOf(Date);
    });

    it("tirar duas vezes: a segunda é changed; inexistente é not-found", async () => {
      const { id } = (await addEntry(users.admin, input())) as { id: string };
      expect((await removeEntry(users.reception, { id })).ok).toBe(true);
      expect(await removeEntry(users.reception, { id })).toEqual({ ok: false, reason: "changed" });
      expect(await removeEntry(users.reception, { id: randomUUID() })).toEqual({ ok: false, reason: "not-found" });
    });

    it("o profissional (login) não tira ninguém da espera", async () => {
      const { id } = (await addEntry(users.admin, input())) as { id: string };
      expect(await removeEntry(users.profA, { id })).toEqual({ ok: false, reason: "not-found" });
      expect((await rowOf(id))?.status).toBe("waiting");
    });
  });

  describe("listWaitlist", () => {
    const ofMine = <T extends { patientName: string }>(items: T[]): T[] => items.filter((item) => item.patientName.startsWith(TAG));

    it("abertas por ordem de chegada, com os nomes e a preferência", async () => {
      const first = (await addEntry(users.reception, input({ patientId: ids.p1, professionalId: ids.pA, weekdays: [2], startMinute: 480, endMinute: 720, note: "[teste] a" }))) as { id: string };
      const second = (await addEntry(users.reception, input({ patientId: ids.p2 }))) as { id: string };
      const third = (await addEntry(users.reception, input({ patientId: ids.p3, serviceId: ids.svc2 }))) as { id: string };
      const items = ofMine(await listWaitlist(users.reception, { view: "open" }));
      expect(items.map((item) => item.id)).toEqual([first.id, second.id, third.id]);
      expect(items[0]).toMatchObject({
        patientName: `${TAG} Paciente 1`,
        serviceName: `${TAG} Sessao`,
        specialty: "physiotherapy",
        professionalId: ids.pA,
        professionalName: `${TAG} Ana`,
        weekdays: [2],
        startMinute: 480,
        endMinute: 720,
        note: "[teste] a",
        status: "waiting",
        closedAt: null,
      });
      expect(items[1]).toMatchObject({ professionalId: null, professionalName: null, weekdays: [], note: null });
    });

    it("encerradas: só as que saíram da espera, da mais recente para a mais antiga", async () => {
      const a = (await addEntry(users.admin, input({ patientId: ids.p1 }))) as { id: string };
      const b = (await addEntry(users.admin, input({ patientId: ids.p2 }))) as { id: string };
      await addEntry(users.admin, input({ patientId: ids.p3 })); // continua aberta
      await removeEntry(users.admin, { id: a.id });
      await removeEntry(users.admin, { id: b.id });
      const closed = ofMine(await listWaitlist(users.admin, { view: "closed" }));
      expect(closed.map((item) => item.id)).toEqual([b.id, a.id]);
      expect(closed.every((item) => item.status === "removed" && item.closedAt instanceof Date)).toBe(true);
      expect(ofMine(await listWaitlist(users.admin, { view: "open" }))).toHaveLength(1);
    });

    it("filtra por especialidade e por profissional", async () => {
      await addEntry(users.admin, input({ patientId: ids.p1, professionalId: ids.pA }));
      await addEntry(users.admin, input({ patientId: ids.p2 }));
      const byPro = ofMine(await listWaitlist(users.admin, { view: "open", professionalId: ids.pA }));
      expect(byPro.map((item) => item.patientName)).toEqual([`${TAG} Paciente 1`]);
      expect(ofMine(await listWaitlist(users.admin, { view: "open", specialty: "physiotherapy" }))).toHaveLength(2);
      expect(ofMine(await listWaitlist(users.admin, { view: "open", specialty: "dentistry" }))).toHaveLength(0);
    });

    it("não lista a espera de paciente removido para a recepção; o admin lista", async () => {
      const { id } = (await addEntry(users.admin, input({ patientId: ids.p1 }))) as { id: string };
      await owner`update public.patients set deleted_at = now() where id = ${ids.p1}`;
      try {
        expect(ofMine(await listWaitlist(users.reception, { view: "open" })).map((item) => item.id)).not.toContain(id);
        expect(ofMine(await listWaitlist(users.admin, { view: "open" })).map((item) => item.id)).toContain(id);
      } finally {
        await owner`update public.patients set deleted_at = null where id = ${ids.p1}`;
      }
    });

    it("o profissional (login) não recebe nada", async () => {
      await addEntry(users.admin, input());
      expect(await listWaitlist(users.profA, { view: "open" })).toEqual([]);
      expect(await listWaitlist(users.profA, { view: "closed" })).toEqual([]);
    });
  });
});
