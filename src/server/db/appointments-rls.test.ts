import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Tx } from "./client";
import { seedAgenda, type AgendaSeed } from "./appointments-rls-fixture";
import { createRlsHarness, hasDb } from "./rls-harness";
import { appointmentPrices, appointments, patients, professionals } from "./schema";

const sorted = (list: string[]) => [...list].sort();

/**
 * RLS da agenda (Fase 2), parte 1: LEITURA, valor copiado e catálogo do Postgres, contra o Supabase
 * DEV, só dados FICTÍCIOS, transações sempre revertidas. Regras:
 *  - admin lê todos os atendimentos; recepção os de profissional não removido; o profissional SÓ os
 *    próprios; sem perfil, inativo, removido ou `aal1` não lê nada;
 *  - o valor (`appointment_prices`) é SÓ de admin e recepção: o profissional nunca o lê;
 *  - o nome do paciente chega ao profissional pela leitura de `patients` (só os vinculados a ele).
 * A escrita e o gatilho estão em `appointments-rls-write.test.ts`.
 */
describe.skipIf(!hasDb)("RLS da agenda: leitura e catálogo (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared((tx, ids) => seedAgenda(tx, ids, "Agenda RLS"));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  const seen = async (tx: Tx, s: AgendaSeed) =>
    sorted((await tx.select({ id: appointments.id }).from(appointments).where(inArray(appointments.id, s.all))).map((r) => r.id));
  const seenPrices = async (tx: Tx, s: AgendaSeed) =>
    sorted(
      (await tx.select({ id: appointmentPrices.appointmentId }).from(appointmentPrices).where(inArray(appointmentPrices.appointmentId, s.all))).map(
        (r) => r.id,
      ),
    );

  describe("atendimentos", () => {
    it("o admin lê todos", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await seen(tx, s)).toEqual(sorted(s.all));
      });
    });

    it("a recepção lê todos (os profissionais não estão removidos)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        expect(await seen(tx, s)).toEqual(sorted(s.all));
      });
    });

    it("o profissional lê SÓ os próprios, nunca os do colega", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await seen(tx, s)).toEqual(sorted(s.all.filter((id) => id !== s.a2)));
        await as(ids.professional2);
        expect(await seen(tx, s)).toEqual([s.a2]);
      });
    });

    it.each(["stranger", "inactive", "deleted"] as const)("usuário %s não lê nenhum", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await seen(tx, s)).toEqual([]);
      });
    });

    it.each(["admin", "reception", "professional"] as const)("%s com aal1 não lê nenhum", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await seen(tx, s)).toEqual([]);
      });
    });

    it("com o profissional removido, a recepção deixa de ver os atendimentos dele; o admin continua vendo", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        // remover = soltar o login (regra do cadastro): então o profissional também deixa de enxergar
        await tx.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.professionalA));
        await as(ids.reception);
        expect(await seen(tx, s)).toEqual([s.a2]);
        await as(ids.admin);
        expect(await seen(tx, s)).toEqual(sorted(s.all));
        await as(ids.professional);
        expect(await seen(tx, s)).toEqual([]);
      });
    });

    it("o nome do paciente chega ao profissional só para os vinculados a ele (a RLS de patients)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        const rows = await tx
          .select({ id: appointments.id, patient: patients.fullName })
          .from(appointments)
          .leftJoin(patients, eq(patients.id, appointments.patientId))
          .where(inArray(appointments.id, [s.a1, s.a6]));
        const byId = Object.fromEntries(rows.map((row) => [row.id, row.patient]));
        expect(byId[s.a1]).toBe("[teste] Paciente Um"); // vinculado a A
        expect(byId[s.a6]).toBeNull(); // p4 não é vinculado a A: o nome não chega
      });
    });
  });

  describe("valor copiado (appointment_prices)", () => {
    it("admin e recepção leem os valores; o profissional NUNCA", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        for (const who of [ids.admin, ids.reception]) {
          await as(who);
          expect(await seenPrices(tx, s)).toEqual(sorted([s.a1, s.a2, s.a3]));
        }
        for (const who of [ids.professional, ids.professional2]) {
          await as(who);
          expect(await seenPrices(tx, s)).toEqual([]);
        }
      });
    });

    it.each(["stranger", "inactive", "deleted"] as const)("usuário %s não lê valor nenhum", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await seenPrices(tx, s)).toEqual([]);
      });
    });

    it.each(["admin", "reception"] as const)("%s com aal1 não lê valor nenhum", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await seenPrices(tx, s)).toEqual([]);
      });
    });

    it("o valor lido é o que foi copiado (centavos inteiros)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        const [row] = await tx.select({ cents: appointmentPrices.priceCents }).from(appointmentPrices).where(eq(appointmentPrices.appointmentId, s.a1));
        expect(row?.cents).toBe(15_000);
      });
    });
  });

  describe("privilégios, políticas, gatilho e exclusões (catálogo do Postgres)", () => {
    it("appointments: authenticated lê e insere; UPDATE só por coluna; sem DELETE; anon e service_role sem escrita; RLS ligada", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const [row] = await tx.execute<Record<string, boolean>>(sql`
          select
            has_table_privilege('anon', 'public.appointments', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon,
            has_any_column_privilege('anon', 'public.appointments', 'SELECT,INSERT,UPDATE,REFERENCES') as "anonCols",
            has_table_privilege('authenticated', 'public.appointments', 'SELECT') as sel,
            has_table_privilege('authenticated', 'public.appointments', 'INSERT') as ins,
            has_table_privilege('authenticated', 'public.appointments', 'UPDATE') as upd,
            has_table_privilege('authenticated', 'public.appointments', 'DELETE') as del,
            has_table_privilege('authenticated', 'public.appointments', 'TRUNCATE,REFERENCES,TRIGGER') as extra,
            has_table_privilege('service_role', 'public.appointments', 'UPDATE') as "serviceUpd",
            has_table_privilege('service_role', 'public.appointments', 'DELETE') as "serviceDel",
            has_table_privilege('service_role', 'public.appointments', 'TRUNCATE') as "serviceTrunc",
            (select relrowsecurity from pg_class where oid = 'public.appointments'::regclass) as rls`);
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

    it("UPDATE só nas colunas status, starts_at, ends_at e cancel_reason (chaves, serviço, autor e carimbos ficam de fora)", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const can = async (column: string) => {
          const [row] = await tx.execute<{ ok: boolean }>(
            sql`select has_column_privilege('authenticated', 'public.appointments', ${column}, 'UPDATE') as ok`,
          );
          return row?.ok;
        };
        for (const column of ["status", "starts_at", "ends_at", "cancel_reason"]) expect(await can(column), column).toBe(true);
        for (const column of [
          "id",
          "professional_id",
          "patient_id",
          "service_id",
          "specialty",
          "created_by",
          "created_at",
          "status_changed_at",
          "status_changed_by",
          "updated_at",
        ]) {
          expect(await can(column), column).toBe(false);
        }
      });
    });

    it("appointment_prices: authenticated lê e insere, sem UPDATE nem DELETE; anon e service_role sem escrita; RLS ligada", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const [row] = await tx.execute<Record<string, boolean>>(sql`
          select
            has_table_privilege('anon', 'public.appointment_prices', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon,
            has_any_column_privilege('anon', 'public.appointment_prices', 'SELECT,INSERT,UPDATE,REFERENCES') as "anonCols",
            has_table_privilege('authenticated', 'public.appointment_prices', 'SELECT') as sel,
            has_table_privilege('authenticated', 'public.appointment_prices', 'INSERT') as ins,
            has_any_column_privilege('authenticated', 'public.appointment_prices', 'UPDATE') as upd,
            has_table_privilege('authenticated', 'public.appointment_prices', 'DELETE') as del,
            has_table_privilege('authenticated', 'public.appointment_prices', 'TRUNCATE,REFERENCES,TRIGGER') as extra,
            has_table_privilege('service_role', 'public.appointment_prices', 'UPDATE') as "serviceUpd",
            has_table_privilege('service_role', 'public.appointment_prices', 'DELETE') as "serviceDel",
            has_table_privilege('service_role', 'public.appointment_prices', 'TRUNCATE') as "serviceTrunc",
            (select relrowsecurity from pg_class where oid = 'public.appointment_prices'::regclass) as rls`);
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

    it.each(["appointments", "appointment_prices"])("%s tem a política RESTRICTIVE que exige aal2", async (table) => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ policyname: string }>(
          sql`select policyname from pg_policies where schemaname = 'public' and tablename = ${table} and permissive = 'RESTRICTIVE'`,
        );
        expect(rows.map((r) => r.policyname)).toEqual([`${table}_require_aal2`]);
      });
    });

    it("as políticas cobrem só SELECT, INSERT e UPDATE (nenhuma de DELETE); o valor não tem UPDATE", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const cmds = async (table: string) =>
          [
            ...new Set(
              (
                await tx.execute<{ cmd: string }>(
                  sql`select cmd from pg_policies where schemaname = 'public' and tablename = ${table} and permissive = 'PERMISSIVE'`,
                )
              ).map((r) => r.cmd),
            ),
          ].sort();
        expect(await cmds("appointments")).toEqual(["INSERT", "SELECT", "UPDATE"]);
        expect(await cmds("appointment_prices")).toEqual(["INSERT", "SELECT"]);
      });
    });

    it("nenhuma política de appointment_prices dá acesso ao profissional", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const rows = await tx.execute<{ qual: string | null; with_check: string | null }>(
          sql`select qual, with_check from pg_policies where schemaname = 'public' and tablename = 'appointment_prices' and permissive = 'PERMISSIVE'`,
        );
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) expect(`${row.qual ?? ""} ${row.with_check ?? ""}`).not.toContain("professional");
      });
    });

    it("existe o gatilho de atualização e as duas exclusões de conflito (profissional e paciente)", async () => {
      await shared.run(async ({ tx, asOwner }) => {
        await asOwner();
        const triggers = await tx.execute<{ tgname: string }>(
          sql`select tgname from pg_trigger where tgrelid = 'public.appointments'::regclass and not tgisinternal`,
        );
        expect(triggers.map((t) => t.tgname)).toEqual(["appointments_guard_update"]);
        const exclusions = await tx.execute<{ conname: string }>(
          sql`select conname from pg_constraint where conrelid = 'public.appointments'::regclass and contype = 'x' order by conname`,
        );
        expect(exclusions.map((c) => c.conname)).toEqual(["appointments_patient_no_overlap", "appointments_professional_no_overlap"]);
      });
    });
  });
});
