import { randomUUID } from "node:crypto";

import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Tx } from "./client";
import { attempt, createRlsHarness, hasDb } from "./rls-harness";
import { patientConsents, patientProfessionals, patients, professionals } from "./schema";

const sorted = (list: string[]) => [...list].sort();

/**
 * Semente PRÓPRIA deste arquivo, de propósito: o cenário de `patients-rls-fixture.ts` semeia sempre o
 * mesmo profissional ("[teste] Ana Pac") e `professionals` tem índice único por (especialidade, nome).
 * Cada arquivo de RLS mantém a transação aberta o arquivo inteiro, então um terceiro arquivo com o
 * mesmo nome ficava na fila atrás dos outros e o `beforeAll` estourava o tempo. Aqui o nome é único
 * por execução e só se cria o que os testes usam.
 */
type Seed = {
  p1: string; // vinculado ao profissional
  p4: string; // sem vínculo
  p5: string; // REMOVIDO
  all: string[];
};

async function seedConsentScenario(tx: Tx, ids: { professional: string }): Promise<Seed> {
  const [pro] = await tx
    .insert(professionals)
    .values({ fullName: `[teste] Ana Cons ${randomUUID().slice(0, 8)}`, specialty: "physiotherapy", profileId: ids.professional })
    .returning({ id: professionals.id });
  const rows = await tx
    .insert(patients)
    .values([
      { fullName: "[teste] Paciente Um", birthDate: "1990-05-10" },
      { fullName: "[teste] Paciente Quatro", birthDate: "1970-01-01" },
      { fullName: "[teste] Paciente Cinco", birthDate: "1999-09-09", deletedAt: new Date() },
    ])
    .returning({ id: patients.id });
  const [p1, p4, p5] = rows.map((row) => row.id) as [string, string, string];
  await tx.insert(patientProfessionals).values({ patientId: p1, professionalId: pro!.id });
  return { p1, p4, p5, all: [p1, p4, p5] };
}

/**
 * RLS dos consentimentos LGPD (1B-3b) contra o Supabase DEV, só dados FICTÍCIOS, transações sempre
 * revertidas. Regras (spec 1B-3b):
 *  - Histórico SÓ DE INCLUSÃO: ninguém atualiza nem apaga, nem o admin (sem privilégio: 42501).
 *  - Admin lê todos (inclusive de paciente removido); recepção lê só os de paciente não removido.
 *  - O profissional NUNCA vê consentimento, nem o de paciente vinculado a ele.
 *  - Admin e recepção registram, só para paciente não removido, e só em nome próprio (`registered_by`).
 *  - `aal1`, sem perfil, inativo ou removido não vê nem escreve; escrita de quem não pode falha com
 *    42501 ANTES de qualquer constraint.
 */
describe.skipIf(!hasDb)("RLS de consentimentos LGPD (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared(async (tx, ids) => {
    const s = await seedConsentScenario(tx, ids);
    const base = { givenBy: "patient", method: "signed_paper", occurredOn: "2026-01-10", registeredBy: ids.admin };
    await tx.insert(patientConsents).values([
      { ...base, patientId: s.p1, kind: "data_processing", granted: true },
      { ...base, patientId: s.p1, kind: "whatsapp", granted: true },
      { ...base, patientId: s.p4, kind: "data_processing", granted: true }, // sem vínculo com profissional
      { ...base, patientId: s.p5, kind: "data_processing", granted: true }, // paciente REMOVIDO
    ]);
    return s;
  });
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  /** Pacientes (sem repetir) cujos consentimentos aparecem para quem está logado. */
  const seenConsentPatients = async (tx: Tx, s: Seed) =>
    sorted([
      ...new Set(
        (await tx.select({ id: patientConsents.patientId }).from(patientConsents).where(inArray(patientConsents.patientId, s.all))).map(
          (r) => r.id,
        ),
      ),
    ]);

  const novo = (patientId: string, over: Partial<typeof patientConsents.$inferInsert> = {}) => ({
    patientId,
    kind: "data_processing",
    granted: true,
    givenBy: "patient",
    method: "verbal",
    occurredOn: "2026-11-20",
    ...over,
  });

  describe("leitura", () => {
    it("o admin lê os consentimentos de todos, inclusive de paciente removido", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await seenConsentPatients(tx, s)).toEqual(sorted([s.p1, s.p4, s.p5]));
      });
    });

    it("a recepção lê só os de paciente não removido", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        expect(await seenConsentPatients(tx, s)).toEqual(sorted([s.p1, s.p4]));
      });
    });

    it("o profissional não lê nenhum, nem o de paciente vinculado a ele (p1)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await seenConsentPatients(tx, s)).toEqual([]);
      });
    });

    it.each(["professional2", "stranger", "inactive", "deleted"] as const)("usuário %s não lê nenhum", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await seenConsentPatients(tx, s)).toEqual([]);
      });
    });

    it.each(["admin", "reception"] as const)("%s com aal1 não lê nenhum", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await seenConsentPatients(tx, s)).toEqual([]);
      });
    });
  });

  describe("registro (INSERT)", () => {
    it.each(["admin", "reception"] as const)("%s registra em nome próprio (registered_by vem de auth.uid())", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        const [row] = await tx
          .insert(patientConsents)
          .values(novo(s.p1, { granted: false }))
          .returning({ registeredBy: patientConsents.registeredBy, granted: patientConsents.granted });
        expect(row).toEqual({ registeredBy: ids[who], granted: false });
      });
    });

    it("ninguém registra em nome de outro usuário (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { registeredBy: ids.admin })))).toBe("42501");
        await as(ids.admin);
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { registeredBy: ids.reception })))).toBe("42501");
      });
    });

    it.each(["professional", "professional2", "stranger", "inactive", "deleted"] as const)(
      "usuário %s não registra (42501), nem para paciente vinculado a ele",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who]);
          expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1)))).toBe("42501");
        });
      },
    );

    it.each(["admin", "reception"] as const)("%s com aal1 não registra (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1)))).toBe("42501");
      });
    });

    it.each(["admin", "reception"] as const)("%s não registra para paciente removido (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p5)))).toBe("42501");
      });
    });

    it("depois de reativar o paciente, o admin volta a registrar", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        await tx.update(patients).set({ deletedAt: null }).where(eq(patients.id, s.p5));
        const inserted = await tx.insert(patientConsents).values(novo(s.p5)).returning({ id: patientConsents.id });
        expect(inserted).toHaveLength(1);
      });
    });
  });

  describe("só inclusão: ninguém altera nem apaga", () => {
    it.each(["admin", "reception", "professional"] as const)("%s não atualiza (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.update(patientConsents).set({ granted: false }))).toBe("42501");
        expect(await attempt(tx, (x) => x.update(patientConsents).set({ note: "[teste] adulterada" }))).toBe("42501");
      });
    });

    it.each(["admin", "reception", "professional"] as const)("%s não apaga (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.delete(patientConsents))).toBe("42501");
      });
    });

    it("o histórico segue intacto depois das tentativas", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.admin);
        await attempt(tx, (x) => x.update(patientConsents).set({ granted: false }));
        await attempt(tx, (x) => x.delete(patientConsents));
        await asOwner();
        const rows = await tx.select({ granted: patientConsents.granted }).from(patientConsents).where(eq(patientConsents.patientId, s.p1));
        expect(rows).toHaveLength(2);
        expect(rows.every((row) => row.granted)).toBe(true);
      });
    });
  });

  describe("regras do banco", () => {
    it("recusa tipo, quem deu e forma fora da lista (23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { kind: "email" })))).toBe("23514");
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { givenBy: "neighbor" })))).toBe("23514");
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { method: "telepathy" })))).toBe("23514");
      });
    });

    it("recusa data fora de 1900-2100 e aceita data anterior ao registro (23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { occurredOn: "1899-12-31" })))).toBe("23514");
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { occurredOn: "2101-01-01" })))).toBe("23514");
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { occurredOn: "2020-02-29" })))).toBeUndefined();
      });
    });

    it("a nota: opcional, de 1 a 300 caracteres, sem espaço nas pontas nem caractere de controle (23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { note: null })))).toBeUndefined();
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { note: "a".repeat(300) })))).toBeUndefined();
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { note: "a".repeat(301) })))).toBe("23514");
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { note: "" })))).toBe("23514");
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { note: " com espaço" })))).toBe("23514");
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { note: "com\u0007controle" })))).toBe("23514");
      });
    });

    it("um paciente com histórico não pode ser apagado fisicamente (FK restrict, 23503)", async () => {
      await shared.run(async ({ tx, asOwner, seed: s }) => {
        await asOwner();
        expect(await attempt(tx, (x) => x.delete(patients).where(eq(patients.id, s.p1)))).toBe("23503");
      });
    });
  });

  describe("a política vem antes de qualquer constraint (nada vaza por código de erro)", () => {
    it("paciente inexistente: 42501 para admin e recepção, não 23503", async () => {
      await shared.run(async ({ tx, ids, as }) => {
        for (const who of [ids.admin, ids.reception]) {
          await as(who);
          expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(randomUUID())))).toBe("42501");
        }
      });
    });

    it("quem não pode registrar recebe 42501 mesmo com valor inválido, registered_by inexistente ou id repetido", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { kind: "email" })))).toBe("42501");
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { registeredBy: randomUUID() })))).toBe("42501");
        await as(ids.admin, "aal1");
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { registeredBy: randomUUID() })))).toBe("42501");

        // id repetido de um registro que existe: quem não pode registrar não descobre isso por 23505.
        await as(ids.admin);
        const [existing] = await tx.insert(patientConsents).values(novo(s.p1)).returning({ id: patientConsents.id });
        await as(ids.professional);
        expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { id: existing!.id })))).toBe("42501");
      });
    });
  });

  describe("quando foi registrado não se falsifica", () => {
    it("created_at informado pelo cliente é recusado (42501); o carimbo é sempre o do banco", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        for (const who of [ids.admin, ids.reception]) {
          await as(who);
          expect(await attempt(tx, (x) => x.insert(patientConsents).values(novo(s.p1, { createdAt: new Date("2000-01-01T00:00:00Z") })))).toBe("42501");
        }
      });
    });

    it("sem informar created_at, o registro é aceito e carimbado com o now() do banco (não do relógio da máquina)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.admin);
        const [row] = await tx.insert(patientConsents).values(novo(s.p1)).returning({ id: patientConsents.id });
        await asOwner();
        const [stamp] = await tx.execute<{ ok: boolean }>(
          sql`select (created_at = now()) as ok from public.patient_consents where id = ${row!.id}`,
        );
        expect(stamp?.ok).toBe(true);
      });
    });
  });

  describe("privilégios e políticas (catálogo do Postgres)", () => {
    it("authenticated só lê e insere; anon e service_role não alteram nada; RLS ligada", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const [row] = await tx.execute<Record<string, boolean>>(sql`
          select
            has_table_privilege('anon', 'public.patient_consents', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon,
            has_any_column_privilege('anon', 'public.patient_consents', 'SELECT,INSERT,UPDATE,REFERENCES') as "anonCols",
            has_table_privilege('authenticated', 'public.patient_consents', 'SELECT') as sel,
            has_table_privilege('authenticated', 'public.patient_consents', 'INSERT') as ins,
            has_table_privilege('authenticated', 'public.patient_consents', 'UPDATE') as upd,
            has_table_privilege('authenticated', 'public.patient_consents', 'DELETE') as del,
            has_table_privilege('authenticated', 'public.patient_consents', 'TRUNCATE,REFERENCES,TRIGGER') as extra,
            has_table_privilege('service_role', 'public.patient_consents', 'UPDATE') as "serviceUpd",
            has_table_privilege('service_role', 'public.patient_consents', 'DELETE') as "serviceDel",
            has_table_privilege('service_role', 'public.patient_consents', 'TRUNCATE') as "serviceTrunc",
            (select relrowsecurity from pg_class where oid = 'public.patient_consents'::regclass) as rls`);
        expect(row).toEqual({
          anon: false,
          anonCols: false,
          sel: true,
          ins: true,
          upd: false,
          del: false,
          extra: false,
          serviceUpd: false,
          serviceDel: false,
          serviceTrunc: false,
          rls: true,
        });
      });
    });

    it("tem a política RESTRICTIVE que exige aal2", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string }>(
          sql`select policyname from pg_policies where schemaname = 'public' and tablename = 'patient_consents' and permissive = 'RESTRICTIVE'`,
        );
        expect(rows.map((r) => r.policyname)).toEqual(["patient_consents_require_aal2"]);
      });
    });

    it("nenhuma política menciona o profissional e só há SELECT e INSERT", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ cmd: string; qual: string | null; with_check: string | null }>(
          sql`select cmd, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'patient_consents' and permissive = 'PERMISSIVE'`,
        );
        expect(rows.length).toBeGreaterThan(0);
        expect([...new Set(rows.map((r) => r.cmd))].sort()).toEqual(["INSERT", "SELECT"]);
        for (const row of rows) expect(`${row.qual ?? ""} ${row.with_check ?? ""}`).not.toContain("professional");
      });
    });

    it("TRUNCATE ignora a RLS: ninguém (nem o admin) o consegue (42501)", async () => {
      await shared.run(async ({ tx, ids, as }) => {
        for (const who of [ids.admin, ids.reception, ids.professional]) {
          await as(who);
          expect(await attempt(tx, (x) => x.execute(sql`truncate table public.patient_consents`))).toBe("42501");
        }
      });
    });
  });
});
