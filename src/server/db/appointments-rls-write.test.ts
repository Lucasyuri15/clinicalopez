import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { APPOINTMENT_STATUSES, allowedTransitions, type ActorRole } from "@/lib/appointments/status";

import type { Tx } from "./client";
import { FUTURE_DAY, at, seedAgenda, type AgendaSeed } from "./appointments-rls-fixture";
import { pgConstraintName } from "./pg-error";
import { attempt, createRlsHarness, hasDb } from "./rls-harness";
import { appointmentPrices, appointments, patients, professionals, services } from "./schema";

/**
 * RLS da agenda (Fase 2), parte 2: ESCRITA, regras do banco e gatilho contra o Supabase DEV, só dados
 * FICTÍCIOS, transações sempre revertidas. Regras:
 *  - criar: só admin e recepção, em nome próprio, 'scheduled', no futuro, com carimbos do banco;
 *  - conflito de horário (profissional E paciente) é do banco; só a cancelada libera o horário;
 *  - remarcar e mudar status seguem o mapa de `src/lib/appointments/status.ts` (o gatilho é a última
 *    barreira: este arquivo prova que os dois concordam em TODOS os pares, para cada papel);
 *  - chaves, serviço, autor e carimbos não mudam; ninguém apaga; o valor só nasce na mesma transação.
 *  - escrita de quem não pode falha com 42501 ANTES de qualquer constraint.
 */
describe.skipIf(!hasDb)("RLS da agenda: escrita, conflito e gatilho (integração, Supabase dev)", () => {
  const harness = createRlsHarness();
  const shared = harness.shared((tx, ids) => seedAgenda(tx, ids, "Agenda Write"));
  beforeAll(async () => {
    harness.connect();
    await shared.open();
  }, 60_000);
  afterAll(async () => {
    await shared.close();
    await harness.close();
  });

  type NewAppointment = typeof appointments.$inferInsert;
  /** Um horário livre: pA + p1, 16:00 às 16:50Z de 2031-06-02. */
  const novo = (s: AgendaSeed, over: Partial<NewAppointment> = {}): NewAppointment => ({
    professionalId: s.professionalA,
    patientId: s.p1,
    serviceId: s.serviceId,
    specialty: "physiotherapy",
    startsAt: at(FUTURE_DAY, "16:00"),
    endsAt: at(FUTURE_DAY, "16:50"),
    ...over,
  });
  const create = (tx: Tx, values: NewAppointment) => tx.insert(appointments).values(values).returning({ id: appointments.id });
  const slot = (from: string, to: string) => ({ startsAt: at(FUTURE_DAY, from), endsAt: at(FUTURE_DAY, to) });

  /** "ok", "zero" (RLS escondeu a linha: 0 linhas, sem erro) ou o SQLSTATE do erro. */
  async function tryUpdate(tx: Tx, id: string, set: Partial<NewAppointment>): Promise<string> {
    let rows = 0;
    const code = await attempt(tx, async (x) => {
      rows = (await x.update(appointments).set(set).where(eq(appointments.id, id)).returning({ id: appointments.id })).length;
    });
    if (code) return code;
    return rows > 0 ? "ok" : "zero";
  }

  /** O nome da constraint que recusou (para separar profissional de paciente), ou `undefined`. */
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

  describe("criar", () => {
    it.each(["admin", "reception"] as const)("%s cria em nome próprio: nasce agendada, com autor e carimbos do banco", async (who) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids[who]);
        const [row] = await create(tx, novo(s));
        expect(row?.id).toBeTruthy();
        await asOwner();
        const [saved] = await tx.select().from(appointments).where(eq(appointments.id, row!.id));
        expect(saved).toMatchObject({ status: "scheduled", createdBy: ids[who], statusChangedAt: null, statusChangedBy: null, cancelReason: null });
      });
    });

    it.each(["professional", "professional2", "stranger", "inactive", "deleted"] as const)(
      "usuário %s não cria (42501), nem no próprio horário livre",
      async (who) => {
        await shared.run(async ({ tx, ids, as, seed: s }) => {
          await as(ids[who]);
          expect(await attempt(tx, (x) => create(x, novo(s)))).toBe("42501");
        });
      },
    );

    it.each(["admin", "reception"] as const)("%s com aal1 não cria (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who], "aal1");
        expect(await attempt(tx, (x) => create(x, novo(s)))).toBe("42501");
      });
    });

    it("não se falsifica autor, status, carimbos nem a criação (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        const forged: Array<[string, Partial<NewAppointment>]> = [
          ["created_by de outro usuário", { createdBy: ids.admin }],
          ["created_at no passado", { createdAt: new Date("2020-01-01T00:00:00Z") }],
          ["updated_at no passado", { updatedAt: new Date("2020-01-01T00:00:00Z") }],
          ["status confirmada", { status: "confirmed" }],
          ["status realizada", { status: "done" }],
          ["status_changed_by informado", { statusChangedBy: ids.reception }],
          ["status_changed_at informado", { statusChangedAt: new Date() }],
        ];
        for (const [name, over] of forged) {
          expect(await attempt(tx, (x) => create(x, novo(s, over))), name).toBe("42501");
        }
      });
    });

    it("recusa início no passado (42501)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => create(x, novo(s, { startsAt: at("2026-01-02", "10:00"), endsAt: at("2026-01-02", "10:50") })))).toBe("42501");
      });
    });

    it("recusa profissional inativo ou removido, paciente removido e serviço inativo (42501)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => create(x, novo(s, { patientId: s.pRemoved })))).toBe("42501");
        expect(await attempt(tx, (x) => create(x, novo(s, { serviceId: s.inactiveServiceId })))).toBe("42501");
        await asOwner();
        await tx.update(professionals).set({ active: false }).where(eq(professionals.id, s.professionalB));
        await as(ids.admin);
        expect(await attempt(tx, (x) => create(x, novo(s, { professionalId: s.professionalB })))).toBe("42501");
        await asOwner();
        await tx.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.professionalA));
        await as(ids.admin);
        expect(await attempt(tx, (x) => create(x, novo(s)))).toBe("42501");
      });
    });

    it("recusa serviço e profissional de especialidades diferentes (FK composta, 23503)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        // serviço de odontologia declarado como fisioterapia
        expect(await attempt(tx, (x) => create(x, novo(s, { serviceId: s.dentalServiceId })))).toBe("23503");
        // profissional de fisioterapia declarado como odontologia
        expect(await attempt(tx, (x) => create(x, novo(s, { specialty: "dentistry" })))).toBe("23503");
      });
    });

    it("regras de horário do banco: fim depois do início, de 5 em 5 minutos, 5 min a 8 h, 2000–2100 (23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        const bad: Array<[string, Partial<NewAppointment>]> = [
          ["fim igual ao início", slot("16:00", "16:00")],
          ["fim antes do início", slot("16:50", "16:00")],
          ["duração de 4 minutos", { startsAt: at(FUTURE_DAY, "16:00"), endsAt: new Date(at(FUTURE_DAY, "16:00").getTime() + 4 * 60_000) }],
          ["duração fora de 5 em 5", { startsAt: at(FUTURE_DAY, "16:00"), endsAt: new Date(at(FUTURE_DAY, "16:00").getTime() + 7 * 60_000) }],
          ["início com segundos", { startsAt: new Date(at(FUTURE_DAY, "16:00").getTime() + 30_000), endsAt: at(FUTURE_DAY, "16:50") }],
          ["duração de 9 horas", slot("08:00", "17:00")],
          [
            "fim depois de 2100",
            { startsAt: new Date("2100-12-31T23:00:00Z"), endsAt: new Date("2101-01-01T00:30:00Z") },
          ],
        ];
        for (const [name, over] of bad) expect(await attempt(tx, (x) => create(x, novo(s, over))), name).toBe("23514");
        // os limites valem: 5 minutos e 8 horas exatos (num dia sem outros atendimentos)
        expect(await attempt(tx, (x) => create(x, novo(s, slot("16:00", "16:05"))))).toBeUndefined();
        const free = { startsAt: at("2031-06-03", "06:00"), endsAt: at("2031-06-03", "14:00") };
        expect(await attempt(tx, (x) => create(x, novo(s, free)))).toBeUndefined();
      });
    });

    it("cancelada exige motivo e as outras não podem ter (23514)", async () => {
      await shared.run(async ({ tx, ids, asOwner, seed: s }) => {
        await asOwner();
        // o dono do banco não tem `auth.uid()`: o autor precisa ser informado
        const owned = (over: Partial<NewAppointment>) => novo(s, { createdBy: ids.admin, ...over });
        expect(await attempt(tx, (x) => create(x, owned({ status: "cancelled" })))).toBe("23514");
        expect(await attempt(tx, (x) => create(x, owned({ cancelReason: "[teste] sem cancelar" })))).toBe("23514");
        expect(await attempt(tx, (x) => create(x, owned({ status: "cancelled", cancelReason: " com espaço nas pontas " })))).toBe("23514");
        expect(await attempt(tx, (x) => create(x, owned({ status: "cancelled", cancelReason: "[teste] motivo" })))).toBeUndefined();
      });
    });
  });

  describe("conflito de horário (exclusão do banco)", () => {
    it("o mesmo profissional não atende dois pacientes ao mesmo tempo (23P01, exclusão do profissional)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        // a1 ocupa pA de 13:00 a 13:50; outro paciente, mesmo profissional, sobrepondo
        expect(await attempt(tx, (x) => create(x, novo(s, { patientId: s.p3, ...slot("13:30", "14:20") })))).toBe("23P01");
        expect(await constraintOf(tx, (x) => create(x, novo(s, { patientId: s.p3, ...slot("13:30", "14:20") })))).toBe(
          "appointments_professional_no_overlap",
        );
      });
    });

    it("o mesmo paciente não vai a dois lugares ao mesmo tempo (23P01, exclusão do paciente)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        // p1 fica com pA às 18:00–18:50 (livre); depois, com pB (livre nesse horário), sobrepondo o paciente
        await create(tx, novo(s, { patientId: s.p1, ...slot("18:00", "18:50") }));
        const overlap = novo(s, { professionalId: s.professionalB, patientId: s.p1, ...slot("18:20", "19:10") });
        expect(await constraintOf(tx, (x) => create(x, overlap))).toBe("appointments_patient_no_overlap");
      });
    });

    it("terminar quando outro começa NÃO conflita (meio-aberto)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        // a1 termina 13:50 e a3 começa 14:00: um de 13:50 a 14:00 cabe entre os dois
        expect(await attempt(tx, (x) => create(x, novo(s, { patientId: s.p3, ...slot("13:50", "14:00") })))).toBeUndefined();
      });
    });

    it("a cancelada libera o horário: cancelar libera o mesmo profissional e o mesmo paciente", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await attempt(tx, (x) => create(x, novo(s, slot("13:00", "13:50"))))).toBe("23P01"); // a1 ocupa
        const cancelled = await tx
          .update(appointments)
          .set({ status: "cancelled", cancelReason: "[teste] liberar" })
          .where(eq(appointments.id, s.a1))
          .returning({ id: appointments.id });
        expect(cancelled).toHaveLength(1);
        expect(await attempt(tx, (x) => create(x, novo(s, slot("13:00", "13:50"))))).toBeUndefined();
      });
    });

    it("Realizada e Falta CONTINUAM ocupando o horário (o histórico é verdadeiro)", async () => {
      await shared.run(async ({ tx, ids, asOwner, seed: s }) => {
        await asOwner();
        const past = { startsAt: at("2026-01-05", "10:20"), endsAt: at("2026-01-05", "11:10") }; // pega a realizada e a falta
        const overlap = novo(s, { patientId: s.p3, createdBy: ids.admin, ...past });
        expect(await constraintOf(tx, (x) => create(x, overlap))).toBe("appointments_professional_no_overlap");
      });
    });

    it("quem não pode criar recebe 42501 antes de qualquer conflito (nada vaza)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await attempt(tx, (x) => create(x, novo(s, slot("13:00", "13:50"))))).toBe("42501");
        await as(ids.stranger);
        expect(await attempt(tx, (x) => create(x, novo(s, { professionalId: s.professionalB, ...slot("13:00", "13:50") })))).toBe("42501");
      });
    });
  });

  describe("remarcar", () => {
    it.each(["admin", "reception"] as const)("%s remarca um atendimento agendado", async (who) => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids[who]);
        expect(await tryUpdate(tx, s.a1, slot("17:00", "17:50"))).toBe("ok");
        const rows = await tx.update(appointments).set(slot("17:00", "17:50")).where(eq(appointments.id, s.a1)).returning({ status: appointments.status });
        expect(rows[0]?.status).toBe("scheduled");
        await asOwner();
        const [saved] = await tx.select({ startsAt: appointments.startsAt }).from(appointments).where(eq(appointments.id, s.a1));
        expect(saved?.startsAt.toISOString()).toBe(at(FUTURE_DAY, "17:00").toISOString());
      });
    });

    it("remarcar um atendimento confirmado o devolve para agendada (e sem isso é recusado)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.reception);
        // confirmada (a3) sem devolver o status para 'scheduled': recusado
        expect(await tryUpdate(tx, s.a3, slot("17:00", "17:50"))).toBe("42501");
        // devolvendo: vale
        expect(await tryUpdate(tx, s.a3, { ...slot("17:00", "17:50"), status: "scheduled" })).toBe("ok");
        await tx.update(appointments).set({ ...slot("17:00", "17:50"), status: "scheduled" }).where(eq(appointments.id, s.a3));
        await asOwner();
        const [saved] = await tx.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, s.a3));
        expect(saved?.status).toBe("scheduled");
      });
    });

    it("recusa o novo horário no passado (23514) e em cima de outro atendimento (23P01)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await tryUpdate(tx, s.a1, { startsAt: at("2026-01-02", "10:00"), endsAt: at("2026-01-02", "10:50") })).toBe("23514");
        expect(await tryUpdate(tx, s.a1, slot("14:00", "14:50"))).toBe("23P01"); // o horário de a3 (mesmo profissional)
      });
    });

    it("pode se sobrepor ao próprio horário antigo (a exclusão ignora a própria linha)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        expect(await tryUpdate(tx, s.a1, slot("12:40", "13:30"))).toBe("ok");
      });
    });

    it("não remarca o que já foi realizado, faltou ou foi cancelado; nem o profissional; nem trocando o status junto", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        for (const id of [s.closed.done, s.closed.no_show, s.closed.cancelled]) {
          expect(await tryUpdate(tx, id, slot("17:00", "17:50")), id).toBe("42501");
        }
        expect(await tryUpdate(tx, s.a1, { ...slot("17:00", "17:50"), status: "done" })).toBe("42501");
        expect(await tryUpdate(tx, s.a1, { ...slot("17:00", "17:50"), status: "cancelled", cancelReason: "[teste] x" })).toBe("42501");
        await as(ids.professional);
        expect(await tryUpdate(tx, s.a1, slot("17:00", "17:50"))).toBe("42501");
      });
    });

    it("o profissional do colega e quem não tem acesso não alcançam a linha (0 linhas) e aal1 também não", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional2);
        expect(await tryUpdate(tx, s.a1, { status: "done" })).toBe("zero");
        await as(ids.stranger);
        expect(await tryUpdate(tx, s.a1, slot("17:00", "17:50"))).toBe("zero");
        await as(ids.admin, "aal1");
        expect(await tryUpdate(tx, s.a1, slot("17:00", "17:50"))).toBe("zero");
      });
    });
  });

  describe("status: o gatilho concorda com o mapa de status.ts em TODOS os pares", () => {
    const outcome = (result: string) => (result === "ok" ? "ok" : result === "42501" || result === "zero" ? "denied" : `inesperado:${result}`);

    it.each(["admin", "reception", "professional"] as const)("%s: cada par (de → para) vale ou é recusado como o mapa diz", async (role) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[role]);
        for (const from of APPOINTMENT_STATUSES) {
          for (const to of APPOINTMENT_STATUSES) {
            if (to === from) continue;
            const set: Partial<NewAppointment> = to === "cancelled" ? { status: to, cancelReason: "[teste] motivo" } : { status: to };
            const expected = allowedTransitions(role as ActorRole, from).includes(to) ? "ok" : "denied";
            expect(outcome(await tryUpdate(tx, s.closed[from], set)), `${role}: ${from} → ${to}`).toBe(expected);
          }
        }
      });
    });

    it("Realizada e Falta só depois do início (23514); confirmar e cancelar um atendimento futuro vale", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        expect(await tryUpdate(tx, s.a1, { status: "done" })).toBe("23514");
        expect(await tryUpdate(tx, s.a1, { status: "no_show" })).toBe("23514");
        await as(ids.professional);
        expect(await tryUpdate(tx, s.a1, { status: "done" })).toBe("23514");
        await as(ids.reception);
        expect(await tryUpdate(tx, s.a1, { status: "confirmed" })).toBe("ok");
        expect(await tryUpdate(tx, s.a1, { status: "cancelled", cancelReason: "[teste] paciente desistiu" })).toBe("ok");
      });
    });

    it("quem mudou o status e quando vêm do banco; o cliente não os informa nem muda chaves, serviço ou autor", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await as(ids.reception);
        await tx.update(appointments).set({ status: "confirmed" }).where(eq(appointments.id, s.a1));
        await asOwner();
        const [row] = await tx.select().from(appointments).where(eq(appointments.id, s.a1));
        expect(row?.statusChangedBy).toBe(ids.reception);
        expect(row?.statusChangedAt).not.toBeNull();
        expect(row!.updatedAt.getTime()).toBeGreaterThan(row!.createdAt.getTime());

        await as(ids.admin);
        const forbidden: Array<[string, Partial<NewAppointment>]> = [
          ["status_changed_by", { statusChangedBy: ids.admin }],
          ["status_changed_at", { statusChangedAt: new Date() }],
          ["professional_id", { professionalId: s.professionalB }],
          ["patient_id", { patientId: s.p2 }],
          ["service_id", { serviceId: s.inactiveServiceId }],
          ["specialty", { specialty: "dentistry" }],
          ["created_by", { createdBy: ids.reception }],
          ["created_at", { createdAt: new Date("2020-01-01T00:00:00Z") }],
          ["updated_at", { updatedAt: new Date("2020-01-01T00:00:00Z") }],
        ];
        for (const [column, set] of forbidden) expect(await tryUpdate(tx, s.a1, set), column).toBe("42501");
      });
    });

    it("sem motivo não se cancela (23514), e o motivo de uma cancelada não muda", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        expect(await tryUpdate(tx, s.a1, { status: "cancelled" })).toBe("23514");
        expect(await tryUpdate(tx, s.a5, { cancelReason: "[teste] outro motivo" })).toBe("42501"); // cancelada é terminal
      });
    });
  });

  describe("ninguém apaga", () => {
    it.each(["admin", "reception", "professional"] as const)("%s não apaga atendimento (42501)", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        expect(await attempt(tx, (x) => x.delete(appointments).where(eq(appointments.id, s.a1)))).toBe("42501");
      });
    });
  });

  describe("valor copiado (appointment_prices)", () => {
    it.each(["admin", "reception"] as const)("%s grava o valor na MESMA transação do atendimento novo", async (who) => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids[who]);
        const [created] = await create(tx, novo(s));
        expect(await attempt(tx, (x) => x.insert(appointmentPrices).values({ appointmentId: created!.id, priceCents: 15_000 }))).toBeUndefined();
      });
    });

    it("não se grava valor em atendimento antigo (42501), nem o profissional, nem se atualiza ou apaga", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        // a6 já existia (criado antes desta transação) e não tem valor
        expect(await attempt(tx, (x) => x.insert(appointmentPrices).values({ appointmentId: s.a6, priceCents: 1000 }))).toBe("42501");
        await as(ids.professional);
        expect(await attempt(tx, (x) => x.insert(appointmentPrices).values({ appointmentId: s.a6, priceCents: 1000 }))).toBe("42501");
        for (const who of [ids.admin, ids.reception, ids.professional]) {
          await as(who);
          expect(await attempt(tx, (x) => x.update(appointmentPrices).set({ priceCents: 1 }).where(eq(appointmentPrices.appointmentId, s.a1)))).toBe("42501");
          expect(await attempt(tx, (x) => x.delete(appointmentPrices).where(eq(appointmentPrices.appointmentId, s.a1)))).toBe("42501");
        }
      });
    });

    it("valor negativo ou acima do teto é recusado (23514)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        const [created] = await create(tx, novo(s));
        expect(await attempt(tx, (x) => x.insert(appointmentPrices).values({ appointmentId: created!.id, priceCents: -1 }))).toBe("23514");
        expect(await attempt(tx, (x) => x.insert(appointmentPrices).values({ appointmentId: created!.id, priceCents: 10_000_001 }))).toBe("23514");
      });
    });
  });

  describe("casos de borda levantados na revisão independente", () => {
    it("com os claims do JWT apagados, uma sessão `authenticated` não escreve nem lê (o atalho do dono não é alcançável)", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.admin);
        await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
        expect(["zero", "42501"]).toContain(await tryUpdate(tx, s.a1, { status: "confirmed" }));
        expect(await attempt(tx, (x) => create(x, novo(s)))).toBe("42501");
        const visible = await tx.select({ id: appointments.id }).from(appointments).where(eq(appointments.id, s.a1));
        expect(visible).toEqual([]);
      });
    });

    it("o profissional não mexe no motivo, no fim nem no início; um 'update' que não muda nada é inofensivo", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.professional);
        expect(await tryUpdate(tx, s.a1, { cancelReason: "[teste] sem cancelar" })).toBe("23514"); // só o CHECK (status/motivo) barra
        expect(await tryUpdate(tx, s.a1, { endsAt: at(FUTURE_DAY, "13:55") })).toBe("42501");
        expect(await tryUpdate(tx, s.a1, { startsAt: at(FUTURE_DAY, "13:05") })).toBe("42501");
        expect(await tryUpdate(tx, s.a1, { status: "scheduled" })).toBe("ok"); // sem mudança real: só carimba updated_at
      });
    });

    it("atendimentos de paciente REMOVIDO continuam visíveis e canceláveis pela recepção (é operacional: o nome do paciente é que some)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        await tx.update(patients).set({ deletedAt: new Date() }).where(eq(patients.id, s.p4));
        await as(ids.reception);
        const rows = await tx
          .select({ id: appointments.id, patient: patients.fullName })
          .from(appointments)
          .leftJoin(patients, eq(patients.id, appointments.patientId))
          .where(eq(appointments.id, s.a6));
        expect(rows).toEqual([{ id: s.a6, patient: null }]); // a linha aparece; o nome do paciente removido, não
        expect(await tryUpdate(tx, s.a6, { status: "cancelled", cancelReason: "[teste] paciente removido" })).toBe("ok");
      });
    });

    it("CONHECIDO e aceito: o conflito do PACIENTE conta atendimentos de profissional removido que a recepção não enxerga (23P01)", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        // p1 com a profissional A às 18:00–18:50 (horário livre para a profissional B), e então A é removida
        const [hidden] = await create(tx, novo(s, { createdBy: ids.admin, patientId: s.p1, ...slot("18:00", "18:50") }));
        await tx.update(professionals).set({ deletedAt: new Date(), profileId: null }).where(eq(professionals.id, s.professionalA));
        await as(ids.reception);
        // o atendimento não aparece para a recepção...
        const seen = await tx.select({ id: appointments.id }).from(appointments).where(eq(appointments.id, hidden!.id));
        expect(seen).toEqual([]);
        // ...mas continua ocupando o horário do paciente: a recepção descobre isso pelo conflito (baixa sensibilidade: é equipe)
        const overlap = novo(s, { professionalId: s.professionalB, patientId: s.p1, ...slot("18:20", "19:10") });
        expect(await constraintOf(tx, (x) => create(x, overlap))).toBe("appointments_patient_no_overlap");
      });
    });

    it("trocar a especialidade de profissional ou serviço que já têm atendimentos é recusado pelo banco (23503)", async () => {
      await shared.run(async ({ tx, asOwner, seed: s }) => {
        await asOwner();
        expect(await attempt(tx, (x) => x.update(professionals).set({ specialty: "dentistry" }).where(eq(professionals.id, s.professionalA)))).toBe("23503");
        expect(await attempt(tx, (x) => x.update(services).set({ specialty: "dentistry" }).where(eq(services.id, s.serviceId)))).toBe("23503");
      });
    });

    it("upsert (ON CONFLICT DO UPDATE) segue as mesmas regras: a recepção cancela como num update; o profissional não passa; ninguém muda campo protegido", async () => {
      await shared.run(async ({ tx, ids, as, seed: s }) => {
        await as(ids.reception);
        const viaUpsert = (set: Partial<NewAppointment>) => (x: Tx) =>
          x.insert(appointments).values(novo(s, { id: s.a1 })).onConflictDoUpdate({ target: appointments.id, set });
        expect(await attempt(tx, viaUpsert({ status: "cancelled", cancelReason: "[teste] via upsert" }))).toBeUndefined();
        expect(await attempt(tx, viaUpsert({ createdBy: ids.admin }))).toBe("42501");
        expect(await attempt(tx, viaUpsert({ professionalId: s.professionalB }))).toBe("42501");
        await as(ids.professional);
        expect(await attempt(tx, viaUpsert({ status: "done" }))).toBe("42501"); // o INSERT da proposta já é recusado
      });
    });

    it("um profissional inativo deixa de ver e de atualizar os próprios atendimentos", async () => {
      await shared.run(async ({ tx, ids, as, asOwner, seed: s }) => {
        await asOwner();
        await tx.update(professionals).set({ active: false }).where(eq(professionals.id, s.professionalA));
        await as(ids.professional);
        expect(await tx.select({ id: appointments.id }).from(appointments).where(eq(appointments.id, s.a1))).toEqual([]);
        expect(await tryUpdate(tx, s.closed.scheduled, { status: "done" })).toBe("zero");
      });
    });
  });

  it("um serviço referenciado por atendimento não pode ser apagado fisicamente (FK restrict, 23503)", async () => {
    await shared.run(async ({ tx, asOwner, seed: s }) => {
      await asOwner();
      expect(await attempt(tx, (x) => x.delete(services).where(eq(services.id, s.serviceId)))).toBe("23503");
    });
  });
});
