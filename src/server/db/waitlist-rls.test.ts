import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Tx } from "./client";
import { createRlsHarness, hasDb } from "./rls-harness";
import { waitlistEntries } from "./schema";
import { seedWaitlist, type WaitlistSeed } from "./waitlist-rls-fixture";

const sorted = (list: string[]) => [...list].sort();

/**
 * RLS da lista de espera (Fase 3B), parte 1: LEITURA e catálogo do Postgres, contra o Supabase DEV,
 * só dados FICTÍCIOS, transações sempre revertidas. Regras:
 *  - admin lê todas; recepção as de paciente E profissional não removidos (inclusive as encerradas);
 *  - o PROFISSIONAL nunca lê `waitlist_entries` (nem a que aponta para ele); sem perfil, inativo,
 *    removido ou `aal1` não lê nada;
 *  - só SELECT, INSERT e UPDATE (por coluna); sem DELETE nem TRUNCATE para ninguém; `anon` sem acesso;
 *    `aal2` RESTRICTIVE.
 * A escrita e o gatilho estão em `waitlist-rls-write.test.ts`.
 */
describe.skipIf(!hasDb)("RLS da lista de espera: leitura e catálogo (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared((tx, ids) => seedWaitlist(tx, ids, "Waitlist RLS"));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  const seen = async (tx: Tx, s: WaitlistSeed) =>
    sorted((await tx.select({ id: waitlistEntries.id }).from(waitlistEntries).where(inArray(waitlistEntries.id, s.allEntries))).map((r) => r.id));

  it("o admin lê todas", async () => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids.admin);
      expect(await seen(tx, s)).toEqual(sorted(s.allEntries));
    });
  });

  it("a recepção lê as de paciente e profissional não removidos (não vê as do paciente nem do profissional removido)", async () => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids.reception);
      expect(await seen(tx, s)).toEqual(sorted(s.receptionEntries));
      expect(await seen(tx, s)).not.toContain(s.entryRemovedPatient);
      expect(await seen(tx, s)).not.toContain(s.entryGone);
    });
  });

  it.each(["professional", "professional2", "stranger", "inactive", "deleted"] as const)("usuário %s não lê nenhuma espera", async (who) => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids[who]);
      expect(await seen(tx, s)).toEqual([]);
    });
  });

  it.each(["admin", "reception"] as const)("%s com aal1 (só senha) não lê nenhuma espera", async (who) => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids[who], "aal1");
      expect(await seen(tx, s)).toEqual([]);
    });
  });

  describe("catálogo", () => {
    it("privilégios mínimos: authenticated lê e insere; anon e service_role não escrevem; ninguém apaga", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const [row] = await tx.execute(sql`select
            has_table_privilege('anon', 'public.waitlist_entries', 'SELECT,INSERT,UPDATE,DELETE') as anon,
            has_table_privilege('authenticated', 'public.waitlist_entries', 'SELECT') as sel,
            has_table_privilege('authenticated', 'public.waitlist_entries', 'INSERT') as ins,
            has_table_privilege('authenticated', 'public.waitlist_entries', 'UPDATE') as upd,
            has_table_privilege('authenticated', 'public.waitlist_entries', 'DELETE') as del,
            has_table_privilege('authenticated', 'public.waitlist_entries', 'TRUNCATE,REFERENCES,TRIGGER') as extra,
            has_table_privilege('service_role', 'public.waitlist_entries', 'UPDATE') as "serviceUpd",
            has_table_privilege('service_role', 'public.waitlist_entries', 'DELETE') as "serviceDel",
            has_table_privilege('service_role', 'public.waitlist_entries', 'TRUNCATE') as "serviceTrunc",
            has_table_privilege('service_role', 'public.waitlist_entries', 'REFERENCES,TRIGGER') as "serviceExtra",
            (select count(*)::int from pg_trigger where tgrelid = 'public.waitlist_entries'::regclass and tgname = 'waitlist_guard_update' and tgenabled = 'O') as "guardOn",
            (select relrowsecurity from pg_class where oid = 'public.waitlist_entries'::regclass) as rls`);
        expect(row).toEqual({
          anon: false,
          sel: true,
          ins: true,
          upd: false, // só por coluna (abaixo)
          del: false,
          extra: false,
          serviceUpd: false,
          serviceDel: false,
          serviceTrunc: false,
          serviceExtra: false,
          guardOn: 1, // o gatilho existe e está habilitado
          rls: true,
        });
      });
    });

    it("o UPDATE é por coluna: só a preferência, o status e o atendimento (closed_* vêm do gatilho)", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ column_name: string }>(
          sql`select column_name from information_schema.column_privileges
              where table_schema = 'public' and table_name = 'waitlist_entries' and grantee = 'authenticated' and privilege_type = 'UPDATE'
              order by column_name`,
        );
        expect(rows.map((r) => r.column_name)).toEqual([
          "appointment_id",
          "end_minute",
          "note",
          "professional_id",
          "start_minute",
          "status",
          "weekdays",
        ]);
      });
    });

    it("tem a política RESTRICTIVE que exige aal2", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string; qual: string; with_check: string }>(
          sql`select policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'waitlist_entries' and permissive = 'RESTRICTIVE'`,
        );
        expect(rows.map((r) => r.policyname)).toEqual(["waitlist_entries_require_aal2"]);
        expect(rows[0]?.qual).toContain("aal2");
        expect(rows[0]?.with_check).toContain("aal2");
      });
    });

    it("as políticas cobrem só SELECT, INSERT e UPDATE (nenhuma de DELETE) e nenhuma é do profissional", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string; cmd: string }>(
          sql`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'waitlist_entries' and permissive = 'PERMISSIVE' order by policyname`,
        );
        expect([...new Set(rows.map((r) => r.cmd))].sort()).toEqual(["INSERT", "SELECT", "UPDATE"]);
        expect(rows.map((r) => r.policyname)).toEqual([
          "waitlist_entries_insert_staff",
          "waitlist_entries_select_admin",
          "waitlist_entries_select_reception",
          "waitlist_entries_update_admin",
          "waitlist_entries_update_reception",
        ]);
      });
    });
  });
});
