import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { seedSeries, type SeriesSeed } from "./appointment-series-rls-fixture";
import type { Tx } from "./client";
import { createRlsHarness, hasDb } from "./rls-harness";
import { appointmentSeries, appointments } from "./schema";

const sorted = (list: string[]) => [...list].sort();

/**
 * RLS das séries (Fase 3A), parte 1: LEITURA e catálogo do Postgres, contra o Supabase DEV, só dados
 * FICTÍCIOS, transações sempre revertidas. Regras:
 *  - admin lê todas as séries; recepção as de profissional não removido;
 *  - o PROFISSIONAL nunca lê `appointment_series` (nem a dele), embora veja `series_id` nos próprios
 *    atendimentos (é só um UUID); sem perfil, inativo, removido ou `aal1` não lê nada;
 *  - só SELECT e INSERT; sem UPDATE/DELETE para ninguém; `anon` sem acesso; `aal2` RESTRICTIVE.
 * A escrita, a FK composta e o gatilho estão em `appointment-series-rls-write.test.ts`.
 */
describe.skipIf(!hasDb)("RLS das séries: leitura e catálogo (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared((tx, ids) => seedSeries(tx, ids, "Series RLS"));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  const seen = async (tx: Tx, s: SeriesSeed) =>
    sorted((await tx.select({ id: appointmentSeries.id }).from(appointmentSeries).where(inArray(appointmentSeries.id, s.allSeries))).map((r) => r.id));

  it("o admin lê todas", async () => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids.admin);
      expect(await seen(tx, s)).toEqual(sorted(s.allSeries));
    });
  });

  it("a recepção lê as de profissional não removido (não vê a do profissional removido)", async () => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids.reception);
      expect(await seen(tx, s)).toEqual(sorted([s.seriesA, s.seriesB]));
    });
  });

  it.each(["professional", "professional2", "stranger", "inactive", "deleted"] as const)("usuário %s não lê nenhuma série", async (who) => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids[who]);
      expect(await seen(tx, s)).toEqual([]);
    });
  });

  it.each(["admin", "reception"] as const)("%s com aal1 (só senha) não lê nenhuma série", async (who) => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids[who], "aal1");
      expect(await seen(tx, s)).toEqual([]);
    });
  });

  it("o profissional vê o series_id da própria sessão, mas continua sem ler a série", async () => {
    await shared.run(async ({ tx, ids, as, seed: s }) => {
      await as(ids.professional);
      const [own] = await tx.select({ id: appointments.id, seriesId: appointments.seriesId }).from(appointments).where(eq(appointments.id, s.sessionA));
      expect(own).toEqual({ id: s.sessionA, seriesId: s.seriesA });
      // A sessão da colega nem aparece.
      const other = await tx.select({ id: appointments.id }).from(appointments).where(eq(appointments.id, s.sessionB));
      expect(other).toEqual([]);
      expect(await seen(tx, s)).toEqual([]);
    });
  });

  describe("catálogo", () => {
    it("privilégios mínimos: authenticated só lê e insere; anon e service_role não escrevem", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const [row] = await tx.execute(sql`select
            has_table_privilege('anon', 'public.appointment_series', 'SELECT,INSERT,UPDATE,DELETE') as anon,
            has_table_privilege('authenticated', 'public.appointment_series', 'SELECT') as sel,
            has_table_privilege('authenticated', 'public.appointment_series', 'INSERT') as ins,
            has_table_privilege('authenticated', 'public.appointment_series', 'UPDATE') as upd,
            has_table_privilege('authenticated', 'public.appointment_series', 'DELETE') as del,
            has_table_privilege('authenticated', 'public.appointment_series', 'TRUNCATE,REFERENCES,TRIGGER') as extra,
            has_table_privilege('service_role', 'public.appointment_series', 'UPDATE') as "serviceUpd",
            has_table_privilege('service_role', 'public.appointment_series', 'DELETE') as "serviceDel",
            has_table_privilege('service_role', 'public.appointment_series', 'TRUNCATE') as "serviceTrunc",
            has_column_privilege('authenticated', 'public.appointments', 'series_id', 'UPDATE') as "seriesIdUpd",
            (select relrowsecurity from pg_class where oid = 'public.appointment_series'::regclass) as rls`);
        expect(row).toEqual({
          anon: false,
          sel: true,
          ins: true,
          upd: false,
          del: false,
          extra: false,
          serviceUpd: false,
          serviceDel: false,
          serviceTrunc: false,
          seriesIdUpd: false,
          rls: true,
        });
      });
    });

    it("tem a política RESTRICTIVE que exige aal2", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string; qual: string; with_check: string }>(
          sql`select policyname, qual, with_check from pg_policies where schemaname = 'public' and tablename = 'appointment_series' and permissive = 'RESTRICTIVE'`,
        );
        expect(rows.map((r) => r.policyname)).toEqual(["appointment_series_require_aal2"]);
        expect(rows[0]?.qual).toContain("aal2");
        expect(rows[0]?.with_check).toContain("aal2");
      });
    });

    it("as políticas cobrem só SELECT e INSERT (nenhuma de UPDATE nem DELETE) e nenhuma é do profissional", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string; cmd: string }>(
          sql`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'appointment_series' and permissive = 'PERMISSIVE' order by policyname`,
        );
        expect([...new Set(rows.map((r) => r.cmd))].sort()).toEqual(["INSERT", "SELECT"]);
        expect(rows.map((r) => r.policyname)).toEqual([
          "appointment_series_insert_staff",
          "appointment_series_select_admin",
          "appointment_series_select_reception",
        ]);
      });
    });
  });
});
