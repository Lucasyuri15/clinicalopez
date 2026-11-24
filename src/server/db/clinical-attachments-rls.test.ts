import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedClinicalAttachments } from "./clinical-attachments-rls-fixture";
import type { Tx } from "./client";
import { createRlsHarness, hasDb } from "./rls-harness";
import { clinicalAttachments } from "./schema";

const sorted = <T extends string | number>(list: T[]) => [...list].sort();

/**
 * RLS dos anexos clínicos (Fase 4B-1), parte 1: LEITURA e catálogo, contra o Supabase DEV, só dados
 * FICTÍCIOS, transações sempre revertidas. Mesmo sigilo da evolução:
 *  - o ADMIN lê tudo (inclusive os removidos);
 *  - o PROFISSIONAL lê só o que ELE anexou, pelo autor e NUNCA pelo vínculo com o paciente: dois
 *    profissionais no mesmo paciente não leem um ao outro;
 *  - recepção, sem perfil, inativo, removido, `aal1` e profissional com cadastro inativo ou removido
 *    não leem nada;
 *  - `anon` e `service_role` sem acesso; sem DELETE para ninguém; `aal2` RESTRICTIVE.
 * A escrita e os gatilhos estão em `clinical-attachments-rls-write.test.ts`.
 */
describe.skipIf(!hasDb)("RLS dos anexos clínicos: leitura e catálogo (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared((tx, ids) => seedClinicalAttachments(tx, ids, "Attachments RLS"));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  const seen = async (tx: Tx, all: string[]) =>
    sorted(
      (await tx.select({ id: clinicalAttachments.id }).from(clinicalAttachments).where(inArray(clinicalAttachments.id, all))).map(
        (r) => r.id,
      ),
    );

  it("o admin lê todos os anexos, inclusive o removido", async () => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids.admin);
      expect(await seen(tx, s.allAttachments)).toEqual(sorted(s.allAttachments));
    });
  });

  it("o profissional A lê só o que anexou; o B só o dele, MESMO com o paciente vinculado aos dois", async () => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids.professional);
      expect(await seen(tx, s.allAttachments)).toEqual(sorted(s.attachmentsOfA));
      await as(ids.professional2);
      expect(await seen(tx, s.allAttachments)).toEqual(sorted(s.attachmentsOfB));
    });
  });

  it.each(["reception", "stranger", "inactive", "deleted"] as const)("usuário %s não lê anexo", async (who) => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids[who]);
      expect(await seen(tx, s.allAttachments)).toEqual([]);
    });
  });

  it.each(["admin", "professional"] as const)("%s com aal1 (só senha) não lê nada", async (who) => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids[who], "aal1");
      expect(await seen(tx, s.allAttachments)).toEqual([]);
    });
  });

  it("profissional com cadastro INATIVO ou REMOVIDO perde o acesso aos próprios anexos", async () => {
    await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
      await asOwner();
      await tx.execute(sql`update public.professionals set active = false where id = ${s.professionalA}`);
      await as(ids.professional);
      expect(await seen(tx, s.allAttachments)).toEqual([]);
    });
    await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
      await asOwner();
      await tx.execute(sql`update public.professionals set deleted_at = now(), profile_id = null where id = ${s.professionalA}`);
      await as(ids.professional);
      expect(await seen(tx, s.allAttachments)).toEqual([]);
    });
  });

  it("o acesso é pelo AUTOR, não pelo vínculo: desvincular ou remover o paciente não tira o anexo do autor", async () => {
    await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
      await asOwner();
      await tx.execute(sql`delete from public.patient_professionals where patient_id = ${s.pShared} and professional_id = ${s.professionalA}`);
      await as(ids.professional);
      expect(await seen(tx, s.allAttachments)).toEqual(sorted(s.attachmentsOfA));
    });
    await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
      await asOwner();
      await tx.execute(sql`update public.patients set deleted_at = now() where id = ${s.pShared}`);
      await as(ids.professional);
      expect(await seen(tx, s.allAttachments)).toEqual(sorted(s.attachmentsOfA));
      await as(ids.admin);
      expect(await seen(tx, s.allAttachments)).toEqual(sorted(s.allAttachments));
    });
  });

  describe("catálogo", () => {
    it("privilégios mínimos: authenticated lê e insere; anon e service_role não escrevem; ninguém apaga", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const name = "public.clinical_attachments";
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

    it("UPDATE por coluna: só removed_at e removed_by", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ column_name: string }>(
          sql`select column_name from information_schema.column_privileges
              where table_schema = 'public' and table_name = 'clinical_attachments'
                and grantee = 'authenticated' and privilege_type = 'UPDATE' order by column_name`,
        );
        expect(rows.map((r) => r.column_name)).toEqual(["removed_at", "removed_by"]);
      });
    });

    it("tem a política RESTRICTIVE que exige aal2", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string; qual: string; with_check: string }>(
          sql`select policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'clinical_attachments' and permissive = 'RESTRICTIVE'`,
        );
        expect(rows.map((r) => r.policyname)).toEqual(["clinical_attachments_require_aal2"]);
        expect(rows[0]?.qual).toContain("aal2");
        expect(rows[0]?.with_check).toContain("aal2");
      });
    });

    it("não há política de DELETE e nenhuma delas é da recepção", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ cmd: string; qual: string | null; with_check: string | null }>(
          sql`select cmd, qual, with_check from pg_policies
              where schemaname = 'public' and tablename = 'clinical_attachments' and permissive = 'PERMISSIVE'`,
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.map((r) => r.cmd)).not.toContain("DELETE");
        expect(rows.map((r) => r.cmd)).not.toContain("ALL");
        for (const row of rows) expect(`${row.qual ?? ""}${row.with_check ?? ""}`).not.toContain("reception");
      });
    });
  });
});
