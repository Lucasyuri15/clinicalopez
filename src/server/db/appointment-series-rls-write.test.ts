import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FUTURE_DAY, at, seedSeries, type SeriesSeed } from "./appointment-series-rls-fixture";
import type { Tx } from "./client";
import { pgConstraintName } from "./pg-error";
import { attempt, createRlsHarness, hasDb } from "./rls-harness";
import { appointmentSeries, appointments, services } from "./schema";

/**
 * RLS das séries (Fase 3A), parte 2: ESCRITA, FK composta e gatilho contra o Supabase DEV, só dados
 * FICTÍCIOS, transações sempre revertidas. Regras:
 *  - criar a série: só admin e recepção, em nome próprio, com `created_at` do banco; profissional e
 *    serviço ativos, paciente não removido; sem UPDATE nem DELETE para ninguém;
 *  - a FK composta faz o banco garantir que toda sessão da série é do mesmo profissional, paciente e
 *    serviço (23503), e que `series_id` nulo (atendimento avulso) continua valendo;
 *  - `series_id` é imutável: sem privilégio de coluna (42501) e, mesmo que um dia houvesse, o gatilho
 *    recusa (42501), em qualquer sentido (avulso → série, série → avulso, série → outra série);
 *  - escrita de quem não pode falha com 42501 ANTES de qualquer constraint.
 */
describe.skipIf(!hasDb)("RLS das séries: escrita, FK composta e gatilho (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared((tx, ids) => seedSeries(tx, ids, "Series Write"));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  type NewSeries = typeof appointmentSeries.$inferInsert;
  type NewAppointment = typeof appointments.$inferInsert;
  const novaSerie = (s: SeriesSeed, over: Partial<NewSeries> = {}): NewSeries => ({
    professionalId: s.professionalA,
    patientId: s.p1,
    serviceId: s.serviceId,
    specialty: "physiotherapy",
    ...over,
  });
  const createSeries = (tx: Tx, values: NewSeries) => tx.insert(appointmentSeries).values(values).returning({ id: appointmentSeries.id });
  /** Uma sessão livre (pA + p1, 16:00 às 16:50Z de 2031-06-02) já ligada à série. */
  const sessao = (s: SeriesSeed, over: Partial<NewAppointment> = {}): NewAppointment => ({
    seriesId: s.seriesA,
    professionalId: s.professionalA,
    patientId: s.p1,
    serviceId: s.serviceId,
    specialty: "physiotherapy",
    startsAt: at(FUTURE_DAY, "16:00"),
    endsAt: at(FUTURE_DAY, "16:50"),
    ...over,
  });
  const createAppointment = (tx: Tx, values: NewAppointment) => tx.insert(appointments).values(values).returning({ id: appointments.id });

  /** O nome da constraint que recusou, ou `undefined` se nada foi recusado. */
  async function constraintOf(tx: Tx, fn: (tx: Tx) => Promise<unknown>): Promise<string | undefined> {
    class Rollback extends Error {}
    try {
      await tx.transaction(async (savepoint) => {
        await fn(savepoint as unknown as Tx);
        throw new Rollback();
      });
    } catch (error) {
      if (error instanceof Rollback) return undefined;
      return pgConstraintName(error) ?? "sem-constraint";
    }
    return undefined;
  }

  describe("criar a série", () => {
    it.each(["admin", "reception"] as const)("%s cria em nome próprio, com autor e criação do banco", async (who) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids[who]);
        const [row] = await createSeries(tx, novaSerie(s));
        expect(row?.id).toBeTruthy();
        await asOwner();
        const [saved] = await tx.select().from(appointmentSeries).where(eq(appointmentSeries.id, row!.id));
        expect(saved).toMatchObject({ createdBy: ids[who], professionalId: s.professionalA, patientId: s.p1, serviceId: s.serviceId });
      });
    });

    it.each(["professional", "professional2", "stranger", "inactive", "deleted"] as const)("usuário %s não cria (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => createSeries(x, novaSerie(s)))).toBe("42501");
      });
    });

    it.each(["admin", "reception"] as const)("%s com aal1 não cria (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await attempt(tx, (x) => createSeries(x, novaSerie(s)))).toBe("42501");
      });
    });

    it("não se falsifica autor nem a data de criação (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        expect(await attempt(tx, (x) => createSeries(x, novaSerie(s, { createdBy: ids.admin })))).toBe("42501");
        expect(await attempt(tx, (x) => createSeries(x, novaSerie(s, { createdAt: new Date("2020-01-01T00:00:00Z") })))).toBe("42501");
      });
    });

    it("recusa profissional removido, paciente removido e serviço inativo (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => createSeries(x, novaSerie(s, { professionalId: s.professionalGone })))).toBe("42501");
        expect(await attempt(tx, (x) => createSeries(x, novaSerie(s, { patientId: s.pRemoved })))).toBe("42501");
        expect(await attempt(tx, (x) => createSeries(x, novaSerie(s, { serviceId: s.inactiveServiceId })))).toBe("42501");
      });
    });

    it("o banco recusa serviço de outra especialidade (23503, FK composta)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => createSeries(x, novaSerie(s, { serviceId: s.dentalServiceId })))).toBe("23503");
      });
    });
  });

  describe("a série não se altera nem se apaga", () => {
    it.each(["admin", "reception"] as const)("%s não atualiza nem apaga série (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.update(appointmentSeries).set({ patientId: s.p3 }).where(eq(appointmentSeries.id, s.seriesA)))).toBe("42501");
        expect(await attempt(tx, (x) => x.delete(appointmentSeries).where(eq(appointmentSeries.id, s.seriesA)))).toBe("42501");
      });
    });
  });

  describe("sessões da série (FK composta)", () => {
    it.each(["admin", "reception"] as const)("%s cria uma sessão ligada à série, e o avulso (series_id nulo) continua valendo", async (who) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids[who]);
        const [row] = await createAppointment(tx, sessao(s));
        const [loose] = await createAppointment(tx, sessao(s, { seriesId: null, startsAt: at(FUTURE_DAY, "17:00"), endsAt: at(FUTURE_DAY, "17:50") }));
        await asOwner();
        const [saved] = await tx.select({ seriesId: appointments.seriesId }).from(appointments).where(eq(appointments.id, row!.id));
        const [savedLoose] = await tx.select({ seriesId: appointments.seriesId }).from(appointments).where(eq(appointments.id, loose!.id));
        expect(saved?.seriesId).toBe(s.seriesA);
        expect(savedLoose?.seriesId).toBeNull();
      });
    });

    it("o banco recusa sessão de outro paciente, de outro profissional ou de outro serviço (23503)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        // Um segundo serviço de fisioterapia, ativo, criado pelo dono (nome único por execução).
        await asOwner();
        const [other] = await tx
          .insert(services)
          .values({ name: `[teste] Outro ${crypto.randomUUID().slice(0, 8)}`, specialty: "physiotherapy", durationMinutes: 40 })
          .returning({ id: services.id });
        await as(ids.admin);

        for (const [name, over] of [
          ["outro paciente", { patientId: s.p3 }],
          ["outro profissional", { professionalId: s.professionalB }],
          ["outro serviço", { serviceId: other!.id }],
        ] as const) {
          expect(await constraintOf(tx, (x) => createAppointment(x, sessao(s, over))), name).toBe("appointments_series_fk");
        }
      });
    });

    it("o profissional continua sem criar atendimento, com ou sem série (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => createAppointment(x, sessao(s)))).toBe("42501");
      });
    });
  });

  describe("series_id é imutável", () => {
    it.each(["admin", "reception"] as const)("%s não altera series_id: não há privilégio de coluna (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.update(appointments).set({ seriesId: null }).where(eq(appointments.id, s.sessionA)))).toBe("42501");
      });
    });

    it("mesmo COM o privilégio de coluna, o gatilho recusa qualquer troca de series_id (42501)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        // O privilégio só existe nesta transação (desfeita no fim): serve para provar o gatilho sozinho.
        await asOwner();
        await tx.execute(sql`grant update (series_id) on table public.appointments to authenticated`);
        await as(ids.admin);

        const set = (id: string, seriesId: string | null) => (x: Tx) =>
          x.update(appointments).set({ seriesId }).where(eq(appointments.id, id));
        // Controle: gravar o MESMO valor não é troca e passa (prova que o 42501 abaixo é do gatilho).
        expect(await attempt(tx, set(s.sessionA, s.seriesA))).toBeUndefined();
        expect(await attempt(tx, set(s.sessionA, null)), "série → avulso").toBe("42501");
        expect(await attempt(tx, set(s.sessionA, s.seriesB)), "série → outra série").toBe("42501");
        expect(await attempt(tx, set(s.a1, s.seriesA)), "avulso → série").toBe("42501");
      });
    });

    it("o gatilho continua deixando remarcar e mudar o status da sessão de uma série", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        const moved = await tx
          .update(appointments)
          .set({ startsAt: at(FUTURE_DAY, "18:00"), endsAt: at(FUTURE_DAY, "18:50") })
          .where(eq(appointments.id, s.sessionA))
          .returning({ status: appointments.status, seriesId: appointments.seriesId });
        expect(moved).toEqual([{ status: "scheduled", seriesId: s.seriesA }]);
        const cancelled = await tx
          .update(appointments)
          .set({ status: "cancelled", cancelReason: "[teste] cancelada" })
          .where(eq(appointments.id, s.sessionA))
          .returning({ status: appointments.status, seriesId: appointments.seriesId });
        expect(cancelled).toEqual([{ status: "cancelled", seriesId: s.seriesA }]);
      });
    });
  });
});
