import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedClinical } from "./clinical-rls-fixture";
import type { Tx } from "./client";
import { createRlsHarness, hasDb } from "./rls-harness";
import { clinicalAccessLog, clinicalNoteAddenda, clinicalNotes } from "./schema";

const sorted = <T extends string | number>(list: T[]) => [...list].sort();

/**
 * RLS do prontuário (Fase 4A), parte 1: LEITURA e catálogo do Postgres, contra o Supabase DEV, só
 * dados FICTÍCIOS, transações sempre revertidas. Regras:
 *  - o ADMIN lê tudo (evoluções, rascunhos, adendos e o log);
 *  - o PROFISSIONAL lê só o que ELE escreveu, pelo autor da evolução e NUNCA pelo vínculo com o
 *    paciente: dois profissionais no mesmo paciente não leem um ao outro;
 *  - recepção, sem perfil, inativo, removido, `aal1` e profissional com cadastro inativo ou removido
 *    não leem nada; o log é legível só pelo admin;
 *  - `anon` e `service_role` sem acesso; sem DELETE para ninguém; `aal2` RESTRICTIVE.
 * A escrita e os gatilhos estão em `clinical-rls-write.test.ts`.
 */
describe.skipIf(!hasDb)("RLS do prontuário: leitura e catálogo (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared((tx, ids) => seedClinical(tx, ids, "Clinical RLS"));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  const notesSeen = async (tx: Tx, all: string[]) =>
    sorted((await tx.select({ id: clinicalNotes.id }).from(clinicalNotes).where(inArray(clinicalNotes.id, all))).map((r) => r.id));
  const addendaSeen = async (tx: Tx, all: string[]) =>
    sorted((await tx.select({ id: clinicalNoteAddenda.id }).from(clinicalNoteAddenda).where(inArray(clinicalNoteAddenda.id, all))).map((r) => r.id));
  const logSeen = async (tx: Tx, id: number) =>
    (await tx.select({ id: clinicalAccessLog.id }).from(clinicalAccessLog).where(sql`${clinicalAccessLog.id} = ${id}`)).map((r) => r.id);

  it("o admin lê todas as evoluções (inclusive rascunhos), os adendos e o log", async () => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids.admin);
      expect(await notesSeen(tx, s.allNotes)).toEqual(sorted(s.allNotes));
      expect(await addendaSeen(tx, [s.addendumA, s.addendumB])).toEqual(sorted([s.addendumA, s.addendumB]));
      expect(await logSeen(tx, s.logA)).toEqual([s.logA]);
    });
  });

  it("o profissional A lê só o que escreveu; o B só o dele, MESMO com o paciente vinculado aos dois", async () => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids.professional);
      expect(await notesSeen(tx, s.allNotes)).toEqual(sorted(s.notesOfA));
      expect(await addendaSeen(tx, [s.addendumA, s.addendumB])).toEqual([s.addendumA]);
      await as(ids.professional2);
      expect(await notesSeen(tx, s.allNotes)).toEqual(sorted(s.notesOfB));
      expect(await addendaSeen(tx, [s.addendumA, s.addendumB])).toEqual([s.addendumB]);
    });
  });

  it("o profissional nunca lê o log de acesso (nem as próprias linhas)", async () => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids.professional);
      expect(await logSeen(tx, s.logA)).toEqual([]);
    });
  });

  it.each(["reception", "stranger", "inactive", "deleted"] as const)("usuário %s não lê evolução, adendo nem log", async (who) => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids[who]);
      expect(await notesSeen(tx, s.allNotes)).toEqual([]);
      expect(await addendaSeen(tx, [s.addendumA, s.addendumB])).toEqual([]);
      expect(await logSeen(tx, s.logA)).toEqual([]);
    });
  });

  it.each(["admin", "professional"] as const)("%s com aal1 (só senha) não lê nada", async (who) => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids[who], "aal1");
      expect(await notesSeen(tx, s.allNotes)).toEqual([]);
      expect(await addendaSeen(tx, [s.addendumA, s.addendumB])).toEqual([]);
      expect(await logSeen(tx, s.logA)).toEqual([]);
    });
  });

  it("profissional com cadastro INATIVO ou REMOVIDO perde o acesso às próprias evoluções", async () => {
    await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
      await asOwner();
      await tx.execute(sql`update public.professionals set active = false where id = ${s.professionalA}`);
      await as(ids.professional);
      expect(await notesSeen(tx, s.allNotes)).toEqual([]);
      expect(await addendaSeen(tx, [s.addendumA, s.addendumB])).toEqual([]);
    });
    await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
      await asOwner();
      // O banco só deixa remover o profissional depois de soltar o login (`professionals_removed_unlinked_check`).
      await tx.execute(sql`update public.professionals set deleted_at = now(), profile_id = null where id = ${s.professionalA}`);
      await as(ids.professional);
      expect(await notesSeen(tx, s.allNotes)).toEqual([]);
    });
  });

  it("o acesso é pelo AUTOR, não pelo vínculo: desvincular ou remover o paciente não tira a evolução do autor, e o admin continua lendo", async () => {
    await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
      await asOwner();
      await tx.execute(sql`delete from public.patient_professionals where patient_id = ${s.pShared} and professional_id = ${s.professionalA}`);
      await as(ids.professional);
      expect(await notesSeen(tx, s.allNotes)).toEqual(sorted(s.notesOfA));
    });
    await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
      await asOwner();
      await tx.execute(sql`update public.patients set deleted_at = now() where id = ${s.pShared}`);
      await as(ids.professional);
      expect(await notesSeen(tx, s.allNotes)).toEqual(sorted(s.notesOfA));
      await as(ids.admin);
      expect(await notesSeen(tx, s.allNotes)).toEqual(sorted(s.allNotes));
    });
  });

  describe("catálogo", () => {
    const TABLES = ["clinical_notes", "clinical_note_addenda", "clinical_access_log"] as const;

    it.each(TABLES)("%s: privilégios mínimos (authenticated lê e insere; anon e service_role não escrevem; ninguém apaga)", async (table) => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const name = `public.${table}`;
        const [row] = await tx.execute(sql`select
            has_table_privilege('anon', ${name}, 'SELECT,INSERT,UPDATE,DELETE') as anon,
            has_table_privilege('authenticated', ${name}, 'SELECT') as sel,
            has_table_privilege('authenticated', ${name}, 'INSERT') as ins,
            has_table_privilege('authenticated', ${name}, 'DELETE') as del,
            has_table_privilege('authenticated', ${name}, 'TRUNCATE,REFERENCES,TRIGGER') as extra,
            has_table_privilege('service_role', ${name}, 'INSERT') as "serviceIns",
            has_table_privilege('service_role', ${name}, 'UPDATE') as "serviceUpd",
            has_table_privilege('service_role', ${name}, 'DELETE') as "serviceDel",
            has_table_privilege('service_role', ${name}, 'TRUNCATE') as "serviceTrunc",
            has_table_privilege('service_role', ${name}, 'REFERENCES,TRIGGER') as "serviceExtra",
            (select relrowsecurity from pg_class where oid = ${name}::regclass) as rls`);
        expect(row).toEqual({
          anon: false,
          sel: true,
          ins: true,
          del: false,
          extra: false,
          serviceIns: false,
          serviceUpd: false,
          serviceDel: false,
          serviceTrunc: false,
          serviceExtra: false,
          rls: true,
        });
      });
    });

    it("UPDATE por coluna: só a evolução (texto e status); adendo e log nunca mudam", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ table_name: string; column_name: string }>(
          sql`select table_name, column_name from information_schema.column_privileges
              where table_schema = 'public' and table_name in ('clinical_notes', 'clinical_note_addenda', 'clinical_access_log')
                and grantee = 'authenticated' and privilege_type = 'UPDATE' order by table_name, column_name`,
        );
        expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual(["clinical_notes.body", "clinical_notes.status"]);
        const [priv] = await tx.execute(sql`select
            has_table_privilege('authenticated', 'public.clinical_note_addenda', 'UPDATE') as addenda,
            has_table_privilege('authenticated', 'public.clinical_access_log', 'UPDATE') as log`);
        expect(priv).toEqual({ addenda: false, log: false });
      });
    });

    it.each(TABLES)("%s tem a política RESTRICTIVE que exige aal2", async (table) => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string; qual: string; with_check: string }>(
          sql`select policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename = ${table} and permissive = 'RESTRICTIVE'`,
        );
        expect(rows.map((r) => r.policyname)).toEqual([`${table}_require_aal2`]);
        expect(rows[0]?.qual).toContain("aal2");
        expect(rows[0]?.with_check).toContain("aal2");
      });
    });

    it("não há política de DELETE e nenhuma delas é da recepção", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string; cmd: string; qual: string | null; with_check: string | null }>(
          sql`select policyname, cmd, qual, with_check from pg_policies
              where schemaname = 'public' and tablename in ('clinical_notes', 'clinical_note_addenda', 'clinical_access_log') and permissive = 'PERMISSIVE'`,
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.map((r) => r.cmd)).not.toContain("DELETE");
        expect(rows.map((r) => r.cmd)).not.toContain("ALL");
        for (const row of rows) expect(`${row.qual ?? ""}${row.with_check ?? ""}`).not.toContain("reception");
      });
    });
  });
});
