import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { zonedToUtc } from "@/lib/datetime";
import { weekdayOf } from "@/lib/schedule/calendar";
import {
  cancelAppointment,
  changeAppointmentStatus,
  createAppointment,
  rescheduleAppointment,
} from "@/server/appointments/mutations";
import { getAppointment, listAppointments } from "@/server/appointments/queries";
import { registerConsent } from "@/server/patients/consent-mutations";
import { addTimeOff, scheduleLockKey } from "@/server/schedule/mutations";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Camada de dados da agenda (Fase 2) contra o Supabase DEV pelo caminho REAL do app (`DATABASE_URL` →
 * `app_backend` → `authenticated` sob RLS, via `withUser`). Só dados FICTÍCIOS. Fixtures commitados
 * pelo dono e apagados no fim (o código usa outra conexão). A RLS em si está em
 * `appointments-rls*.test.ts`; aqui se prova que criar, remarcar, cancelar e mudar status respeitam
 * grade, folgas, serviço e conflito de ponta a ponta, que o vínculo e o valor nascem juntos e que um
 * pedido recusado não deixa nada para trás (atômico), inclusive sob concorrência.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-agenda ${randomUUID().slice(0, 8)}]`;
const DAY = "2031-06-02";
const WEEKDAY = weekdayOf(DAY);
const NEXT_DAY = "2031-06-03";
const at = (time: string, day = DAY) => zonedToUtc(day, time);
const slot = (from: string, to: string, day = DAY) => ({ startsAt: at(from, day), endsAt: at(to, day) });

describe.skipIf(!hasDb)("camada de dados da agenda (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = {
    admin: { userId: randomUUID() },
    reception: { userId: randomUUID() },
    profA: { userId: randomUUID() },
    profB: { userId: randomUUID() },
  };
  const ids = {
    pA: "",
    pB: "",
    pInactive: "",
    svc: "",
    svc2: "",
    svcNotOffered: "",
    insurance: "",
    p1: "", // com convênio
    p2: "", // particular
    p3: "",
    p4: "",
    pRemoved: "",
  };

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`agenda-${key}-${userId}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role) values
        (${users.admin.userId}, ${`${TAG} Admin`}, 'admin'),
        (${users.reception.userId}, ${`${TAG} Recepcao`}, 'reception'),
        (${users.profA.userId}, ${`${TAG} Login A`}, 'professional'),
        (${users.profB.userId}, ${`${TAG} Login B`}, 'professional')`;
      const pros = await owner`insert into public.professionals (full_name, specialty, profile_id, active) values
        (${`${TAG} Ana`}, 'physiotherapy', ${users.profA.userId}, true),
        (${`${TAG} Bia`}, 'physiotherapy', ${users.profB.userId}, true),
        (${`${TAG} Inativa`}, 'physiotherapy', null, false) returning id`;
      [ids.pA, ids.pB, ids.pInactive] = pros.map((row) => row.id as string) as [string, string, string];
      const svcs = await owner`insert into public.services (name, specialty, duration_minutes) values
        (${`${TAG} Sessao`}, 'physiotherapy', 50),
        (${`${TAG} Avaliacao`}, 'physiotherapy', 60),
        (${`${TAG} Nao oferecido`}, 'physiotherapy', 30) returning id`;
      [ids.svc, ids.svc2, ids.svcNotOffered] = svcs.map((row) => row.id as string) as [string, string, string];
      await owner`insert into public.professional_services (professional_id, service_id, specialty) values
        (${ids.pA}, ${ids.svc}, 'physiotherapy'), (${ids.pA}, ${ids.svc2}, 'physiotherapy'),
        (${ids.pB}, ${ids.svc}, 'physiotherapy'), (${ids.pInactive}, ${ids.svc}, 'physiotherapy')`;
      const [ins] = await owner`insert into public.insurances (name) values (${`${TAG} Plano`}) returning id`;
      ids.insurance = ins!.id;
      await owner`insert into public.service_prices (service_id, insurance_id, price_cents) values
        (${ids.svc}, null, 15000), (${ids.svc}, ${ids.insurance}, 10000)`;
      const pats = await owner`insert into public.patients (full_name, birth_date, deleted_at) values
        (${`${TAG} Paciente 1`}, '1990-05-10', null), (${`${TAG} Paciente 2`}, '1985-03-02', null),
        (${`${TAG} Paciente 3`}, '2001-12-31', null), (${`${TAG} Paciente 4`}, '1970-01-01', null),
        (${`${TAG} Paciente Removido`}, '1999-09-09', now()) returning id`;
      [ids.p1, ids.p2, ids.p3, ids.p4, ids.pRemoved] = pats.map((row) => row.id as string) as [string, string, string, string, string];
      await owner`insert into public.patient_private (patient_id, no_cpf_reason, insurance_id) values
        (${ids.p1}, '[teste] sem cpf', ${ids.insurance}), (${ids.p2}, '[teste] sem cpf', null),
        (${ids.p3}, '[teste] sem cpf', null), (${ids.p4}, '[teste] sem cpf', null)`;
      await owner`insert into public.professional_work_hours (professional_id, weekday, start_minute, end_minute) values
        (${ids.pA}, ${WEEKDAY}, 480, 720), (${ids.pA}, ${WEEKDAY}, 840, 1080),
        (${ids.pB}, ${WEEKDAY}, 480, 1080), (${ids.pInactive}, ${WEEKDAY}, 480, 1080)`;
      // folga da Ana nesse dia, das 10:00 às 11:00 (Brasília)
      await owner`insert into public.professional_time_off (professional_id, starts_at, ends_at)
        values (${ids.pA}, ${at("10:00")}, ${at("11:00")})`;
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  async function cleanup() {
    const like = `${TAG}%`;
    const patientIds = owner`select id from public.patients where full_name like ${like}`;
    await owner`delete from public.appointment_prices where appointment_id in
      (select id from public.appointments where patient_id in (${patientIds}))`;
    await owner`delete from public.appointments where patient_id in (${patientIds})`;
    await owner`delete from public.patient_consents where patient_id in (${patientIds})`;
    await owner`delete from public.patient_professionals where patient_id in (${patientIds})`;
    await owner`delete from public.patient_private where patient_id in (${patientIds})`;
    await owner`delete from public.patients where full_name like ${like}`;
    const proIds = owner`select id from public.professionals where full_name like ${like}`;
    await owner`delete from public.professional_time_off where professional_id in (${proIds})`;
    await owner`delete from public.professional_work_hours where professional_id in (${proIds})`;
    await owner`delete from public.professional_services where professional_id in (${proIds})`;
    await owner`delete from public.professionals where full_name like ${like}`;
    await owner`delete from public.service_prices where service_id in (select id from public.services where name like ${like})`;
    await owner`delete from public.services where name like ${like}`;
    await owner`delete from public.insurances where name like ${like}`;
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

  /** Apaga os atendimentos do teste (e valores/vínculos) entre um teste e outro. */
  async function reset() {
    const patientIds = owner`select id from public.patients where full_name like ${`${TAG}%`}`;
    await owner`delete from public.appointment_prices where appointment_id in
      (select id from public.appointments where patient_id in (${patientIds}))`;
    await owner`delete from public.appointments where patient_id in (${patientIds})`;
    await owner`delete from public.patient_professionals where patient_id in (${patientIds})`;
    await owner`delete from public.professional_time_off where professional_id = ${ids.pA} and starts_at <> ${at("10:00")}`;
  }

  const input = (over: Record<string, unknown> = {}) => ({
    patientId: ids.p1,
    professionalId: ids.pA,
    serviceId: ids.svc,
    ...slot("09:00", "09:50"),
    ...over,
  });
  const rowOf = async (id: string) => (await owner`select * from public.appointments where id = ${id}`)[0];
  const countFor = async (patientId: string) =>
    Number((await owner`select count(*) from public.appointments where patient_id = ${patientId}`)[0]!.count);

  /** Insere um atendimento direto (dono do banco), para montar cenários que a tela não cria. */
  async function seedAppointment(over: {
    professionalId?: string;
    patientId?: string;
    start: Date;
    end: Date;
    status?: string;
    reason?: string | null;
  }): Promise<string> {
    const [row] = await owner`insert into public.appointments (professional_id, patient_id, service_id, specialty, starts_at, ends_at, status, cancel_reason, created_by)
      values (${over.professionalId ?? ids.pA}, ${over.patientId ?? ids.p1}, ${ids.svc}, 'physiotherapy', ${over.start}, ${over.end},
        ${over.status ?? "scheduled"}, ${over.reason ?? null}, ${users.admin.userId}) returning id`;
    return row!.id as string;
  }

  describe("criar", () => {
    it("admin e recepção criam: nasce agendada, com autor, especialidade do profissional, vínculo e valor do CONVÊNIO", async () => {
      await reset();
      for (const [who, patient] of [
        [users.admin, ids.p1],
        [users.reception, ids.p1],
      ] as const) {
        await reset();
        const result = await createAppointment(who, input({ patientId: patient }));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const row = await rowOf(result.id);
        expect(row).toMatchObject({ status: "scheduled", created_by: who.userId, specialty: "physiotherapy", professional_id: ids.pA, patient_id: ids.p1 });
        const [price] = await owner`select price_cents, insurance_id from public.appointment_prices where appointment_id = ${result.id}`;
        expect(price).toMatchObject({ price_cents: 10_000, insurance_id: ids.insurance });
        const links = await owner`select 1 from public.patient_professionals where patient_id = ${ids.p1} and professional_id = ${ids.pA}`;
        expect(links).toHaveLength(1);
      }
    });

    it("paciente particular recebe o valor particular; serviço sem valor cadastrado fica sem valor", async () => {
      await reset();
      const particular = await createAppointment(users.admin, input({ patientId: ids.p2 }));
      expect(particular.ok).toBe(true);
      const [price] = await owner`select price_cents, insurance_id from public.appointment_prices where appointment_id = ${(particular as { id: string }).id}`;
      expect(price).toMatchObject({ price_cents: 15_000, insurance_id: null });

      const noPrice = await createAppointment(users.admin, input({ patientId: ids.p3, serviceId: ids.svc2, ...slot("14:00", "15:00") }));
      expect(noPrice.ok).toBe(true);
      const none = await owner`select 1 from public.appointment_prices where appointment_id = ${(noPrice as { id: string }).id}`;
      expect(none).toHaveLength(0);
    });

    it("convênio INATIVO ou REMOVIDO, ou valor do convênio removido: cai para o valor particular", async () => {
      const priceOf = async (id: string) =>
        (await owner`select price_cents, insurance_id from public.appointment_prices where appointment_id = ${id}`)[0];
      const book = async () => {
        await reset();
        const result = await createAppointment(users.admin, input({ patientId: ids.p1 }));
        expect(result.ok).toBe(true);
        return priceOf((result as { id: string }).id);
      };
      const cases: Array<[string, () => Promise<unknown>, () => Promise<unknown>]> = [
        [
          "inativo",
          () => owner`update public.insurances set active = false where id = ${ids.insurance}`,
          () => owner`update public.insurances set active = true where id = ${ids.insurance}`,
        ],
        [
          "removido",
          () => owner`update public.insurances set deleted_at = now() where id = ${ids.insurance}`,
          () => owner`update public.insurances set deleted_at = null where id = ${ids.insurance}`,
        ],
        [
          "valor removido",
          () => owner`update public.service_prices set deleted_at = now() where service_id = ${ids.svc} and insurance_id = ${ids.insurance}`,
          () => owner`update public.service_prices set deleted_at = null where service_id = ${ids.svc} and insurance_id = ${ids.insurance}`,
        ],
      ];
      for (const [name, apply, undo] of cases) {
        await apply();
        try {
          expect(await book(), name).toMatchObject({ price_cents: 15_000, insurance_id: null });
        } finally {
          await undo();
        }
      }
      expect(await book()).toMatchObject({ price_cents: 10_000, insurance_id: ids.insurance }); // tudo restaurado: volta ao convênio
    });

    it("a duração é a escolhida (ajustável), não a do serviço", async () => {
      await reset();
      const result = await createAppointment(users.admin, input({ ...slot("08:00", "10:00") }));
      // 08:00–10:00 bate na folga das 10:00? termina às 10:00: meio-aberto, vale
      expect(result.ok).toBe(true);
      const row = await rowOf((result as { id: string }).id);
      expect((row!.ends_at as Date).getTime() - (row!.starts_at as Date).getTime()).toBe(120 * 60_000);
    });

    it.each([
      ["antes da abertura", slot("07:00", "07:50"), "outside-grid"],
      ["no vão do almoço", slot("12:00", "13:00"), "outside-grid"],
      ["atravessando o almoço", slot("11:30", "14:30"), "outside-grid"],
      ["depois do expediente", slot("18:00", "18:50"), "outside-grid"],
      ["em dia sem faixa", slot("09:00", "09:50", "2031-06-04"), "outside-grid"],
      ["em cima da folga", slot("10:00", "10:50"), "time-off"],
      ["encostando na folga por dentro", slot("10:30", "11:20"), "time-off"],
      ["atravessando a meia-noite", { startsAt: at("23:00"), endsAt: at("00:30", NEXT_DAY) }, "invalid-slot"],
      ["com minutos fora de 5 em 5", { startsAt: at("09:00"), endsAt: new Date(at("09:00").getTime() + 7 * 60_000) }, "invalid-slot"],
    ])("recusa o que fica %s (%s)", async (_name, window, reason) => {
      await reset();
      const result = await createAppointment(users.admin, input(window));
      expect(result).toEqual({ ok: false, reason });
      expect(await countFor(ids.p1)).toBe(0);
    });

    it("terminar quando a folga começa vale (09:00 às 10:00)", async () => {
      await reset();
      expect((await createAppointment(users.admin, input(slot("09:00", "10:00")))).ok).toBe(true);
    });

    it("recusa início no passado (o relógio é injetado)", async () => {
      await reset();
      const result = await createAppointment(users.admin, input(), new Date("2031-06-02T15:00:00Z")); // 12:00 em Brasília
      expect(result).toEqual({ ok: false, reason: "past" });
    });

    it("recusa serviço que o profissional não oferece, profissional inativo, paciente removido ou inexistente", async () => {
      await reset();
      expect(await createAppointment(users.admin, input({ serviceId: ids.svcNotOffered }))).toEqual({ ok: false, reason: "service-not-offered" });
      expect(await createAppointment(users.admin, input({ professionalId: ids.pInactive }))).toEqual({ ok: false, reason: "not-found" });
      expect(await createAppointment(users.admin, input({ patientId: ids.pRemoved }))).toEqual({ ok: false, reason: "not-found" });
      expect(await createAppointment(users.admin, input({ patientId: randomUUID() }))).toEqual({ ok: false, reason: "not-found" });
      expect(await createAppointment(users.admin, input({ serviceId: randomUUID() }))).toEqual({ ok: false, reason: "service-not-offered" });
    });

    it("o profissional não cria (e nada fica gravado), nem para o próprio horário", async () => {
      await reset();
      const result = await createAppointment(users.profA, input());
      expect(result.ok).toBe(false);
      expect(await countFor(ids.p1)).toBe(0);
    });

    it("conflito de PROFISSIONAL e de PACIENTE são resultados distintos, e nada fica para trás (atômico)", async () => {
      await reset();
      expect((await createAppointment(users.admin, input({ patientId: ids.p1 }))).ok).toBe(true); // Ana + p1, 09:00–09:50

      // outro paciente com a mesma profissional, sobrepondo: conflito do PROFISSIONAL
      const professional = await createAppointment(users.admin, input({ patientId: ids.p3, ...slot("09:30", "10:00") }));
      expect(professional).toEqual({ ok: false, reason: "conflict-professional" });
      expect(await countFor(ids.p3)).toBe(0);
      const strayLink = await owner`select 1 from public.patient_professionals where patient_id = ${ids.p3}`;
      expect(strayLink, "o vínculo do pedido recusado não pode ficar").toHaveLength(0);

      // o mesmo paciente com outra profissional, sobrepondo: conflito do PACIENTE
      const patient = await createAppointment(users.admin, input({ professionalId: ids.pB, patientId: ids.p1, ...slot("09:30", "10:20") }));
      expect(patient).toEqual({ ok: false, reason: "conflict-patient" });
    });

    it("atendimentos que apenas se encostam não conflitam; a cancelada libera o horário", async () => {
      await reset();
      const first = await createAppointment(users.admin, input({ patientId: ids.p1 })); // 09:00–09:50
      expect((await createAppointment(users.admin, input({ patientId: ids.p3, ...slot("09:50", "10:00") }))).ok).toBe(true);
      expect((await createAppointment(users.admin, input({ patientId: ids.p4 }))).ok).toBe(false); // ocupado
      expect((await cancelAppointment(users.admin, { id: (first as { id: string }).id, reason: "Paciente desistiu" })).ok).toBe(true);
      expect((await createAppointment(users.admin, input({ patientId: ids.p4 }))).ok).toBe(true); // liberado
    });

    it("duas criações SIMULTÂNEAS no mesmo horário: exatamente uma vence", async () => {
      await reset();
      const [one, two] = await Promise.all([
        createAppointment(users.admin, input({ patientId: ids.p1 })),
        createAppointment(users.reception, input({ patientId: ids.p3 })),
      ]);
      expect([one.ok, two.ok].filter(Boolean)).toHaveLength(1);
      const loser = one.ok ? two : one;
      expect(loser).toEqual({ ok: false, reason: "conflict-professional" });
      const [{ count }] = (await owner`select count(*) from public.appointments where professional_id = ${ids.pA}`) as unknown as [{ count: string }];
      expect(Number(count)).toBe(1);
    });

    it("uma folga criada DEPOIS vale para as próximas reservas (a trava da agenda)", async () => {
      await reset();
      expect((await createAppointment(users.admin, input(slot("16:00", "16:50")))).ok).toBe(true);
      expect((await addTimeOff(users.admin, { professionalId: ids.pA, startsAt: at("17:00"), endsAt: at("18:00"), reason: null })).ok).toBe(true);
      expect(await createAppointment(users.admin, input({ patientId: ids.p3, ...slot("17:00", "17:50") }))).toEqual({
        ok: false,
        reason: "time-off",
      });
      // o atendimento que já existia não é reescrito (contrato da grade)
      expect(await countFor(ids.p1)).toBe(1);
    });
  });

  describe("a trava da agenda", () => {
    it("criar ESPERA uma folga em andamento (trava exclusiva) e então enxerga a folga confirmada", async () => {
      await reset();
      const holder = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let acquired: () => void = () => {};
      const lockTaken = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      // Uma folga em andamento: toma a trava EXCLUSIVA e grava a folga, ainda sem confirmar.
      const timeOff = holder.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${scheduleLockKey(ids.pA)}, 0))`;
        await tx`insert into public.professional_time_off (professional_id, starts_at, ends_at)
          values (${ids.pA}, ${at("16:00")}, ${at("17:00")})`;
        acquired();
        await gate;
      });
      try {
        await lockTaken;
        let settled = false;
        const pending = createAppointment(users.admin, input(slot("16:00", "16:50"))).then((result) => {
          settled = true;
          return result;
        });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        expect(settled, "a reserva precisa esperar a folga em andamento").toBe(false);

        release();
        await timeOff;
        expect(await pending).toEqual({ ok: false, reason: "time-off" });
        expect(await countFor(ids.p1)).toBe(0);
      } finally {
        release();
        await timeOff.catch(() => {});
        await holder.end({ timeout: 2 });
      }
    });
  });

  describe("remarcar", () => {
    it("remarcar para o MESMO horário não muda nada (uma confirmada continua confirmada)", async () => {
      await reset();
      const id = ((await createAppointment(users.reception, input())) as { id: string }).id;
      expect((await changeAppointmentStatus(users.reception, { id, status: "confirmed" }, "reception")).ok).toBe(true);
      expect(await rescheduleAppointment(users.reception, { id, ...slot("09:00", "09:50") })).toEqual({ ok: true, id });
      expect((await rowOf(id))!.status).toBe("confirmed");
    });

    it("remarca para outro horário livre; o profissional e o serviço ficam; confirmada volta a agendada", async () => {
      await reset();
      const created = await createAppointment(users.reception, input());
      const id = (created as { id: string }).id;
      expect((await changeAppointmentStatus(users.reception, { id, status: "confirmed" }, "reception")).ok).toBe(true);
      expect((await rowOf(id))!.status).toBe("confirmed");

      const moved = await rescheduleAppointment(users.reception, { id, ...slot("15:00", "15:50") });
      expect(moved).toEqual({ ok: true, id });
      const row = await rowOf(id);
      expect(row).toMatchObject({ status: "scheduled", professional_id: ids.pA, service_id: ids.svc });
      expect((row!.starts_at as Date).toISOString()).toBe(at("15:00").toISOString());
    });

    it("pode se sobrepor ao próprio horário antigo", async () => {
      await reset();
      const id = ((await createAppointment(users.admin, input())) as { id: string }).id; // 09:00–09:50
      expect((await rescheduleAppointment(users.admin, { id, ...slot("08:30", "09:20") })).ok).toBe(true);
    });

    it("recusa grade, folga, passado e conflito, e o atendimento fica como estava", async () => {
      await reset();
      const id = ((await createAppointment(users.admin, input())) as { id: string }).id;
      await createAppointment(users.admin, input({ patientId: ids.p3, ...slot("15:00", "15:50") }));
      expect(await rescheduleAppointment(users.admin, { id, ...slot("12:00", "13:00") })).toEqual({ ok: false, reason: "outside-grid" });
      expect(await rescheduleAppointment(users.admin, { id, ...slot("10:00", "10:50") })).toEqual({ ok: false, reason: "time-off" });
      expect(await rescheduleAppointment(users.admin, { id, ...slot("15:30", "16:20") })).toEqual({ ok: false, reason: "conflict-professional" });
      expect(await rescheduleAppointment(users.admin, { id, ...slot("14:00", "14:50") }, new Date("2031-06-02T20:00:00Z"))).toEqual({
        ok: false,
        reason: "past",
      });
      expect(((await rowOf(id))!.starts_at as Date).toISOString()).toBe(at("09:00").toISOString());
    });

    it("não remarca o que já foi realizado, faltou ou foi cancelado; nem o profissional; e id inexistente", async () => {
      await reset();
      const past = (status: string, from: string, to: string, reason: string | null = null) =>
        seedAppointment({ start: at(from, "2026-01-05"), end: at(to, "2026-01-05"), status, reason });
      for (const [status, reason] of [
        ["done", null],
        ["no_show", null],
        ["cancelled", "[teste]"],
      ] as const) {
        const id = await past(status, "08:00", "08:50", reason);
        expect(await rescheduleAppointment(users.admin, { id, ...slot("15:00", "15:50") }), status).toEqual({ ok: false, reason: "changed" });
        await owner`delete from public.appointments where id = ${id}`;
      }
      const open = ((await createAppointment(users.admin, input())) as { id: string }).id;
      expect((await rescheduleAppointment(users.profA, { id: open, ...slot("15:00", "15:50") })).ok).toBe(false);
      expect(await rescheduleAppointment(users.admin, { id: randomUUID(), ...slot("15:00", "15:50") })).toEqual({ ok: false, reason: "not-found" });
    });
  });

  describe("cancelar", () => {
    it("cancela com motivo; o motivo e quem cancelou ficam gravados; cancelar de novo é 'changed'", async () => {
      await reset();
      const id = ((await createAppointment(users.reception, input())) as { id: string }).id;
      expect(await cancelAppointment(users.reception, { id, reason: "Paciente avisou que viajou" })).toEqual({ ok: true, id });
      const row = await rowOf(id);
      expect(row).toMatchObject({ status: "cancelled", cancel_reason: "Paciente avisou que viajou", status_changed_by: users.reception.userId });
      expect(await cancelAppointment(users.reception, { id, reason: "De novo" })).toEqual({ ok: false, reason: "changed" });
    });

    it("o profissional não cancela; atendimento inexistente é not-found", async () => {
      await reset();
      const id = ((await createAppointment(users.admin, input())) as { id: string }).id;
      expect((await cancelAppointment(users.profA, { id, reason: "x" })).ok).toBe(false);
      expect((await rowOf(id))!.status).toBe("scheduled");
      expect(await cancelAppointment(users.admin, { id: randomUUID(), reason: "x" })).toEqual({ ok: false, reason: "not-found" });
    });
  });

  describe("mudar status", () => {
    it("a recepção confirma; só depois do início vira Realizada ou Falta (too-early antes)", async () => {
      await reset();
      const id = ((await createAppointment(users.reception, input())) as { id: string }).id;
      expect((await changeAppointmentStatus(users.reception, { id, status: "confirmed" }, "reception")).ok).toBe(true);
      expect(await changeAppointmentStatus(users.reception, { id, status: "done" }, "reception")).toEqual({ ok: false, reason: "too-early" });
      expect(await changeAppointmentStatus(users.admin, { id, status: "no_show" }, "admin")).toEqual({ ok: false, reason: "too-early" });
    });

    it("mudar para o status em que já está devolve 'changed' (não 'sem permissão')", async () => {
      await reset();
      const id = ((await createAppointment(users.reception, input())) as { id: string }).id;
      expect((await changeAppointmentStatus(users.reception, { id, status: "confirmed" }, "reception")).ok).toBe(true);
      expect(await changeAppointmentStatus(users.reception, { id, status: "confirmed" }, "reception")).toEqual({ ok: false, reason: "changed" });
    });

    it("o profissional marca Realizada ou Falta nos PRÓPRIOS atendimentos que já começaram, e nada mais", async () => {
      await reset();
      const own = await seedAppointment({ start: at("08:00", "2026-01-05"), end: at("08:50", "2026-01-05") });
      const otherPro = await seedAppointment({ professionalId: ids.pB, patientId: ids.p3, start: at("08:00", "2026-01-05"), end: at("08:50", "2026-01-05") });
      expect(await changeAppointmentStatus(users.profA, { id: own, status: "done" }, "professional")).toEqual({ ok: true, id: own });
      expect((await rowOf(own))!.status).toBe("done");
      expect((await rowOf(own))!.status_changed_by).toBe(users.profA.userId);
      // o do colega: a RLS esconde a linha (para quem pergunta, ele não existe)
      expect(await changeAppointmentStatus(users.profA, { id: otherPro, status: "done" }, "professional")).toEqual({ ok: false, reason: "not-found" });
      // confirmar é da recepção
      const open = await seedAppointment({ start: at("09:00", "2026-01-05"), end: at("09:50", "2026-01-05") });
      expect(await changeAppointmentStatus(users.profA, { id: open, status: "confirmed" }, "professional")).toEqual({ ok: false, reason: "not-allowed" });
    });

    it("só o admin corrige Realizada ↔ Falta", async () => {
      await reset();
      const id = await seedAppointment({ start: at("08:00", "2026-01-05"), end: at("08:50", "2026-01-05"), status: "done" });
      expect(await changeAppointmentStatus(users.reception, { id, status: "no_show" }, "reception")).toEqual({ ok: false, reason: "not-allowed" });
      expect(await changeAppointmentStatus(users.admin, { id, status: "no_show" }, "admin")).toEqual({ ok: true, id });
    });
  });

  describe("consultas", () => {
    it("lista por janela e filtros; admin e recepção veem tudo; o profissional só os dele; sem valor no resultado", async () => {
      await reset();
      const a = ((await createAppointment(users.admin, input({ patientId: ids.p1 }))) as { id: string }).id;
      const b = ((await createAppointment(users.admin, input({ professionalId: ids.pB, patientId: ids.p2, ...slot("09:00", "09:50") }))) as { id: string }).id;
      const window = { from: at("00:00"), to: at("00:00", NEXT_DAY) };

      const asAdmin = await listAppointments(users.admin, { ...window, role: "admin" });
      expect(asAdmin.map((item) => item.id).sort()).toEqual([a, b].sort());
      const byPro = await listAppointments(users.reception, { ...window, professionalId: ids.pB, role: "reception" });
      expect(byPro.map((item) => item.id)).toEqual([b]);
      const bySpecialty = await listAppointments(users.reception, { ...window, specialty: "dentistry", role: "reception" });
      expect(bySpecialty).toEqual([]);

      const asProfessional = await listAppointments(users.profA, { ...window, role: "professional" });
      expect(asProfessional.map((item) => item.id)).toEqual([a]);
      for (const item of [...asAdmin, ...asProfessional]) {
        expect(item).not.toHaveProperty("priceCents");
        expect(item).not.toHaveProperty("price");
      }
      expect(asAdmin[0]).toMatchObject({ professionalName: expect.stringContaining(TAG), serviceName: expect.stringContaining(TAG) });
    });

    it("o motivo do cancelamento (texto livre) só chega à equipe; o profissional recebe null, em qualquer consulta", async () => {
      await reset();
      const reason = "Motivo reservado do cancelamento";
      const id = ((await createAppointment(users.admin, input())) as { id: string }).id;
      expect((await cancelAppointment(users.reception, { id, reason })).ok).toBe(true);
      const window = { from: at("00:00"), to: at("00:00", NEXT_DAY) };

      const staff = await listAppointments(users.reception, { ...window, role: "reception" });
      expect(staff.find((item) => item.id === id)?.cancelReason).toBe(reason);
      expect((await getAppointment(users.admin, id, { role: "admin" }))?.cancelReason).toBe(reason);

      const professional = await listAppointments(users.profA, { ...window, role: "professional" });
      expect(professional.find((item) => item.id === id)?.cancelReason).toBeNull();
      expect((await getAppointment(users.profA, id, { role: "professional" }))?.cancelReason).toBeNull();
      expect(JSON.stringify(professional)).not.toContain("reservado");
    });

    it("a janela é meio-aberta e ordenada por horário", async () => {
      await reset();
      const late = ((await createAppointment(users.admin, input({ patientId: ids.p1, ...slot("15:00", "15:50") }))) as { id: string }).id;
      const early = ((await createAppointment(users.admin, input({ patientId: ids.p3, ...slot("08:00", "08:50") }))) as { id: string }).id;
      const items = await listAppointments(users.admin, { from: at("00:00"), to: at("00:00", NEXT_DAY), role: "admin" });
      expect(items.map((item) => item.id)).toEqual([early, late]);
      expect(await listAppointments(users.admin, { from: at("08:00"), to: at("08:50"), role: "admin" })).toHaveLength(1); // início == from entra
      expect(await listAppointments(users.admin, { from: at("08:50"), to: at("15:00"), role: "admin" })).toEqual([]); // início == to sai
    });

    it("o nome do paciente só chega ao profissional se ele for vinculado (a criação vincula)", async () => {
      await reset();
      const id = ((await createAppointment(users.admin, input({ patientId: ids.p4 }))) as { id: string }).id;
      const items = await listAppointments(users.profA, { from: at("00:00"), to: at("00:00", NEXT_DAY), role: "professional" });
      expect(items.find((item) => item.id === id)?.patientName).toContain("Paciente 4");
      await owner`delete from public.patient_professionals where patient_id = ${ids.p4}`;
      const hidden = await listAppointments(users.profA, { from: at("00:00"), to: at("00:00", NEXT_DAY), role: "professional" });
      expect(hidden.find((item) => item.id === id)?.patientName).toBeNull();
    });

    it("o aviso de consentimento vem só para a equipe (staff) e nunca para o profissional", async () => {
      await reset();
      const id = ((await createAppointment(users.admin, input({ patientId: ids.p1 }))) as { id: string }).id;
      await registerConsent(users.admin, {
        patientId: ids.p3,
        kind: "data_processing",
        granted: true,
        givenBy: "patient",
        method: "verbal",
        occurredOn: "2026-01-01",
        note: null,
      });
      const window = { from: at("00:00"), to: at("00:00", NEXT_DAY) };
      const staff = await listAppointments(users.admin, { ...window, role: "admin" });
      expect(staff.find((item) => item.id === id)?.lacksDataConsent).toBe(true);
      const professional = await listAppointments(users.profA, { ...window, role: "professional" });
      expect(professional[0]).not.toHaveProperty("lacksDataConsent");
    });

    it("getAppointment devolve o atendimento ou null (inexistente, UUID inválido ou fora da RLS)", async () => {
      await reset();
      const id = ((await createAppointment(users.admin, input())) as { id: string }).id;
      expect((await getAppointment(users.admin, id, { role: "admin" }))?.id).toBe(id);
      expect(await getAppointment(users.admin, randomUUID(), { role: "admin" })).toBeNull();
      expect(await getAppointment(users.admin, "não-é-uuid", { role: "admin" })).toBeNull();
      expect(await getAppointment(users.profB, id, { role: "professional" })).toBeNull(); // o colega não enxerga
    });
  });
});
