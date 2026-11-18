import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { all, link, seed, seenLinks, seenPatients, seenPrivate, sorted } from "./patients-rls-fixture";
import { createRlsHarness, hasDb } from "./rls-harness";
import {
  patientPrivate,
  patientProfessionals,
  patients,
  professionals,
  profiles,
} from "./schema";

/**
 * RLS do cadastro de pacientes (1B-3a), parte 1: LEITURA e privilégios contra o Supabase DEV, só dados FICTÍCIOS, transações
 * sempre revertidas. Regras (spec 1B-3):
 *  - `patients` (clínico-básico): admin lê todos; recepção lê os não removidos; profissional lê SÓ
 *    os pacientes vinculados a ele (e não removidos); admin e recepção criam e editam; só o admin
 *    remove (soft delete); ninguém apaga fisicamente.
 *  - `patient_private` (CPF, endereço, convênio, responsável, observações): SÓ admin e recepção;
 *    o profissional nunca lê, nem de paciente dele.
 *  - `patient_professionals` (vínculo): admin e recepção leem e gravam; o profissional lê só os
 *    próprios vínculos (nunca os de colegas).
 *  - `aal1` não passa; sem perfil, inativo ou removido não vê nem escreve; escrita de quem não
 *    pode falha com 42501 ANTES de qualquer constraint (nada vaza por erro de duplicidade).
 */
describe.skipIf(!hasDb)("RLS de pacientes: leitura e privilégios (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  // Cenário montado UMA vez por arquivo; cada teste roda num savepoint desfeito (ver `rls-harness.ts`).
  const shared = harness.shared((tx, ids) => seed(tx, ids));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  describe("leitura de patients (clínico-básico)", () => {
    it("admin lê todos, inclusive removido e inativo", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await seenPatients(tx, s)).toEqual(sorted(all(s)));
      });
    });

    it("recepção lê todos os NÃO removidos (inclusive inativos)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        expect(await seenPatients(tx, s)).toEqual(sorted([s.p1, s.p2, s.p3, s.p4, s.p6]));
      });
    });

    it("profissional lê SÓ os pacientes vinculados a ele, nunca os de colegas, sem vínculo ou removidos", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await seenPatients(tx, s)).toEqual(sorted([s.p1, s.p3, s.p6])); // p5 removido some
        await as(ids.professional2);
        expect(await seenPatients(tx, s)).toEqual(sorted([s.p2, s.p3]));
      });
    });

    it("o vínculo é o que dá acesso: ao desfazer o vínculo, o paciente some; ao criar, aparece", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        await tx.delete(patientProfessionals).where(and(eq(patientProfessionals.patientId, s.p1), eq(patientProfessionals.professionalId, s.pA)));
        await tx.insert(patientProfessionals).values({ patientId: s.p4, professionalId: s.pA });
        await as(ids.professional);
        expect(await seenPatients(tx, s)).toEqual(sorted([s.p3, s.p4, s.p6]));
      });
    });

    it("profissional removido, desativado ou sem login vinculado não lê nenhum paciente", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.professional);
        expect(await seenPatients(tx, s)).not.toEqual([]); // prova que o fixture existe
        await asOwner();
        await tx.update(professionals).set({ active: false }).where(eq(professionals.id, s.pA)); // desativado
        await tx.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.pB)); // removido
        for (const who of [ids.professional, ids.professional2]) {
          await as(who);
          expect(await seenPatients(tx, s)).toEqual([]);
        }
        await asOwner();
        await tx.update(professionals).set({ active: true, profileId: null }).where(eq(professionals.id, s.pA)); // sem login
        await as(ids.professional);
        expect(await seenPatients(tx, s)).toEqual([]);
      });
    });

    it("profissional VINCULADO cujo perfil foi desativado ou removido depois deixa de ler", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        await tx.update(profiles).set({ active: false }).where(eq(profiles.id, ids.professional));
        await as(ids.professional);
        expect(await seenPatients(tx, s)).toEqual([]);
        await asOwner();
        await tx.update(profiles).set({ active: true, deletedAt: new Date() }).where(eq(profiles.id, ids.professional));
        await as(ids.professional);
        expect(await seenPatients(tx, s)).toEqual([]);
      });
    });

    it("admin e recepção com perfil DESATIVADO ou REMOVIDO deixam de ler (o papel some)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.admin);
        expect(await seenPatients(tx, s)).not.toEqual([]);
        await asOwner();
        await tx.update(profiles).set({ active: false }).where(eq(profiles.id, ids.admin));
        await as(ids.admin);
        expect(await seenPatients(tx, s)).toEqual([]);
        await asOwner();
        await tx.update(profiles).set({ active: true, deletedAt: new Date() }).where(eq(profiles.id, ids.admin));
        await as(ids.admin);
        expect(await seenPatients(tx, s)).toEqual([]);
      });
    });

    it.each(["stranger", "inactive", "deleted"] as const)(
      "usuário %s (sem perfil, inativo ou removido) não lê nada",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who]);
          expect(await seenPatients(tx, s)).toEqual([]);
          expect(await seenPrivate(tx, s)).toEqual([]);
          expect(await seenLinks(tx, s)).toEqual([]);
        });
      },
    );

    it.each(["admin", "reception", "professional"] as const)("%s com JWT aal1 não lê nada", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await seenPatients(tx, s)).toEqual([]);
        expect(await seenPrivate(tx, s)).toEqual([]);
        expect(await seenLinks(tx, s)).toEqual([]);
      });
    });
  });

  describe("leitura de patient_private (CPF, endereço, convênio, responsável, observações)", () => {
    it("admin lê tudo; recepção lê dos não removidos", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await seenPrivate(tx, s)).toEqual(sorted(all(s)));
        await as(ids.reception);
        expect(await seenPrivate(tx, s)).toEqual(sorted([s.p1, s.p2, s.p3, s.p4, s.p6]));
      });
    });

    it("o PROFISSIONAL nunca lê dados administrativos, nem dos pacientes vinculados a ele", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await seenPatients(tx, s)).toEqual(sorted([s.p1, s.p3, s.p6])); // vê o básico...
        expect(await seenPrivate(tx, s)).toEqual([]); // ...e NADA do administrativo
        // nem por junção, nem lendo colunas específicas, nem por contagem
        const joined = await tx
          .select({ cpf: patientPrivate.cpf })
          .from(patients)
          .innerJoin(patientPrivate, eq(patientPrivate.patientId, patients.id));
        expect(joined).toEqual([]);
        const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(patientPrivate);
        expect(count?.n).toBe(0);
      });
    });
  });

  describe("leitura de patient_professionals (vínculos)", () => {
    it("admin lê todos; recepção lê os de paciente e profissional NÃO removidos", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        await tx.insert(patientProfessionals).values({ patientId: s.p4, professionalId: s.pRemoved });
        await as(ids.admin);
        expect(await seenLinks(tx, s)).toEqual(
          sorted([
            link(s.p1, s.pA),
            link(s.p2, s.pB),
            link(s.p3, s.pA),
            link(s.p3, s.pB),
            link(s.p5, s.pA),
            link(s.p6, s.pA),
            link(s.p4, s.pRemoved),
          ]),
        );
        await as(ids.reception);
        expect(await seenLinks(tx, s)).toEqual(
          sorted([link(s.p1, s.pA), link(s.p2, s.pB), link(s.p3, s.pA), link(s.p3, s.pB), link(s.p6, s.pA)]),
        );
      });
    });

    it("profissional lê SÓ os próprios vínculos: nem o de colega no MESMO paciente, nem de paciente removido", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await seenLinks(tx, s)).toEqual(sorted([link(s.p1, s.pA), link(s.p3, s.pA), link(s.p6, s.pA)]));
        await as(ids.professional2);
        expect(await seenLinks(tx, s)).toEqual(sorted([link(s.p2, s.pB), link(s.p3, s.pB)]));
      });
    });
  });

  describe("privilégios e políticas (catálogo do Postgres)", () => {
    const expected: Record<string, { ins: boolean; upd: boolean; del: boolean }> = {
      // UPDATE só por coluna (0019): não há UPDATE de tabela inteira em patients e patient_private.
      patients: { ins: true, upd: false, del: false },
      patient_private: { ins: true, upd: false, del: false },
      patient_professionals: { ins: true, upd: false, del: true },
    };

    it.each(Object.keys(expected))("%s: anon não tem nada; authenticated só o necessário; RLS ligada", async (table) => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const [row] = await tx.execute<Record<string, boolean>>(sql`
          select
            has_table_privilege('anon', ${`public.${table}`}, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon,
            has_any_column_privilege('anon', ${`public.${table}`}, 'SELECT,INSERT,UPDATE,REFERENCES') as "anonCols",
            has_table_privilege('authenticated', ${`public.${table}`}, 'SELECT') as sel,
            has_table_privilege('authenticated', ${`public.${table}`}, 'INSERT') as ins,
            has_table_privilege('authenticated', ${`public.${table}`}, 'UPDATE') as upd,
            has_table_privilege('authenticated', ${`public.${table}`}, 'DELETE') as del,
            has_table_privilege('authenticated', ${`public.${table}`}, 'TRUNCATE,REFERENCES,TRIGGER') as extra,
            (select relrowsecurity from pg_class where oid = ${`public.${table}`}::regclass) as rls`);
        expect(row).toEqual({ anon: false, anonCols: false, sel: true, ...expected[table], extra: false, rls: true });
      });
    });

    it("UPDATE só nas colunas editáveis: chaves e created_at ficam de fora", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const can = async (table: string, column: string) => {
          const [row] = await tx.execute<{ ok: boolean }>(
            sql`select has_column_privilege('authenticated', ${`public.${table}`}, ${column}, 'UPDATE') as ok`,
          );
          return row?.ok;
        };
        for (const [table, column] of [
          ["patients", "id"],
          ["patients", "created_at"],
          ["patient_private", "patient_id"],
          ["patient_private", "created_at"],
        ] as const) {
          expect(await can(table, column), `${table}.${column}`).toBe(false);
        }
        for (const [table, column] of [
          ["patients", "full_name"],
          ["patients", "deleted_at"],
          ["patient_private", "cpf"],
          ["patient_private", "admin_notes"],
        ] as const) {
          expect(await can(table, column), `${table}.${column}`).toBe(true);
        }
      });
    });

    it.each(Object.keys(expected))("%s tem a política RESTRICTIVE que exige aal2", async (table) => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string }>(
          sql`select policyname from pg_policies where schemaname = 'public' and tablename = ${table} and permissive = 'RESTRICTIVE'`,
        );
        expect(rows.map((r) => r.policyname)).toEqual([`${table}_require_aal2`]);
      });
    });

    it("não existe política que dê ao profissional acesso a patient_private (nem de leitura, nem de escrita)", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string; qual: string | null; with_check: string | null }>(
          sql`select policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'patient_private' and permissive = 'PERMISSIVE'`,
        );
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          const text = `${row.qual ?? ""} ${row.with_check ?? ""}`;
          expect(text, row.policyname).not.toContain("'professional'");
        }
      });
    });

    it("a função de vínculo (SECURITY DEFINER) não é executável por anon nem por PUBLIC", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const [row] = await tx.execute<{ anon: boolean; pub: boolean; auth: boolean }>(sql`
          select
            has_function_privilege('anon', 'app.is_own_patient(uuid)', 'EXECUTE') as anon,
            has_function_privilege('public', 'app.is_own_patient(uuid)', 'EXECUTE') as pub,
            has_function_privilege('authenticated', 'app.is_own_patient(uuid)', 'EXECUTE') as auth`);
        expect(row).toEqual({ anon: false, pub: false, auth: true });
      });
    });
  });
});

// Resíduo: estes testes só gravam dentro de transações revertidas. Garantia extra, rodando como dono:
describe.skipIf(!hasDb)("pacientes de teste não ficam gravados", () => {
  const harness = createRlsHarness();
  beforeAll(() => harness.connect());
  afterAll(() => harness.close());
  it("nenhum paciente '[teste]' sobra no banco", async () => {
    await harness.inTx(async ({ tx, asOwner }) => {
      await asOwner();
      const rows = await tx.select({ id: patients.id }).from(patients).where(like(patients.fullName, "[teste]%"));
      expect(rows).toEqual([]);
    });
  });
});
