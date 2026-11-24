import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateOccurrences } from "@/lib/appointments/series";
import { zonedToUtc } from "@/lib/datetime";
import { weekdayOf } from "@/lib/schedule/calendar";
import { getAppointment, listAppointments } from "@/server/appointments/queries";
import {
  cancelSeriesFrom,
  createSeries,
  previewRenewal,
  previewSeries,
  renewSeries,
  rescheduleSeriesFrom,
} from "@/server/appointments/series-mutations";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Séries (Fase 3A) pela camada de dados contra o Supabase DEV, pelo caminho REAL do app
 * (`DATABASE_URL` → `app_backend` → `authenticated` sob RLS, via `withUser`). Só dados FICTÍCIOS,
 * commitados pelo dono e apagados no fim. Prova, de ponta a ponta: a série grava só as datas que
 * cabem (grade, folga, passado, conflito de profissional e de paciente) e diz por que pulou as outras;
 * o valor copiado e o vínculo nascem juntos; nada é gravado quando nenhuma cabe; a prévia não grava; duas
 * séries disputando o mesmo horário não geram sobreposição; e renovar acrescenta à mesma série.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-serie ${randomUUID().slice(0, 8)}]`;
const DAY = "2031-11-03"; // segunda-feira
const WEEKDAY = weekdayOf(DAY);
const at = (time: string, day = DAY) => zonedToUtc(day, time);
const NOW = new Date("2031-01-01T12:00:00Z");

describe.skipIf(!hasDb)("séries: camada de dados (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = {
    admin: { userId: randomUUID() },
    reception: { userId: randomUUID() },
    profA: { userId: randomUUID() },
  };
  const ids = { pA: "", pB: "", pInactive: "", svc: "", svcNotOffered: "", insurance: "", p1: "", p2: "", pRemoved: "" };

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`serie-${key}-${userId}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role) values
        (${users.admin.userId}, ${`${TAG} Admin`}, 'admin'),
        (${users.reception.userId}, ${`${TAG} Recepcao`}, 'reception'),
        (${users.profA.userId}, ${`${TAG} Login A`}, 'professional')`;
      const pros = await owner`insert into public.professionals (full_name, specialty, profile_id, active) values
        (${`${TAG} Ana`}, 'physiotherapy', ${users.profA.userId}, true),
        (${`${TAG} Bia`}, 'physiotherapy', null, true),
        (${`${TAG} Inativa`}, 'physiotherapy', null, false) returning id`;
      [ids.pA, ids.pB, ids.pInactive] = pros.map((row) => row.id as string) as [string, string, string];
      const svcs = await owner`insert into public.services (name, specialty, duration_minutes) values
        (${`${TAG} Sessao`}, 'physiotherapy', 50),
        (${`${TAG} Nao oferecido`}, 'physiotherapy', 30) returning id`;
      [ids.svc, ids.svcNotOffered] = svcs.map((row) => row.id as string) as [string, string];
      await owner`insert into public.professional_services (professional_id, service_id, specialty) values
        (${ids.pA}, ${ids.svc}, 'physiotherapy'), (${ids.pB}, ${ids.svc}, 'physiotherapy'),
        (${ids.pInactive}, ${ids.svc}, 'physiotherapy')`;
      const [ins] = await owner`insert into public.insurances (name) values (${`${TAG} Plano`}) returning id`;
      ids.insurance = ins!.id;
      await owner`insert into public.service_prices (service_id, insurance_id, price_cents) values
        (${ids.svc}, null, 15000), (${ids.svc}, ${ids.insurance}, 10000)`;
      const pats = await owner`insert into public.patients (full_name, birth_date, deleted_at) values
        (${`${TAG} Paciente 1`}, '1990-05-10', null), (${`${TAG} Paciente 2`}, '1985-03-02', null),
        (${`${TAG} Paciente Removido`}, '1999-09-09', now()) returning id`;
      [ids.p1, ids.p2, ids.pRemoved] = pats.map((row) => row.id as string) as [string, string, string];
      await owner`insert into public.patient_private (patient_id, no_cpf_reason, insurance_id) values
        (${ids.p1}, '[teste] sem cpf', ${ids.insurance}), (${ids.p2}, '[teste] sem cpf', null)`;
      await owner`insert into public.professional_work_hours (professional_id, weekday, start_minute, end_minute) values
        (${ids.pA}, ${WEEKDAY}, 480, 720), (${ids.pA}, ${WEEKDAY}, 840, 1080),
        (${ids.pInactive}, ${WEEKDAY}, 480, 1080)`;
      // A Bia atende todos os dias da semana (os testes de "remarcar daqui para frente" trocam o dia).
      for (let weekday = 0; weekday <= 6; weekday++) {
        await owner`insert into public.professional_work_hours (professional_id, weekday, start_minute, end_minute)
          values (${ids.pB}, ${weekday}, 480, 1080)`;
      }
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  async function wipeAppointments() {
    const patientIds = owner`select id from public.patients where full_name like ${`${TAG}%`}`;
    await owner`delete from public.appointment_prices where appointment_id in
      (select id from public.appointments where patient_id in (${patientIds}))`;
    await owner`delete from public.appointments where patient_id in (${patientIds})`;
    await owner`delete from public.appointment_series where patient_id in (${patientIds})`;
    await owner`delete from public.patient_professionals where patient_id in (${patientIds})`;
  }

  async function cleanup() {
    const like = `${TAG}%`;
    await wipeAppointments();
    await owner`delete from public.patient_private where patient_id in (select id from public.patients where full_name like ${like})`;
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

  async function reset() {
    await wipeAppointments();
    await owner`delete from public.professional_time_off where professional_id in (${ids.pA}, ${ids.pB})`;
  }

  /** Segundas-feiras às 14:00, 50 min: 2031-11-03, 11-10, 11-17, 11-24 (`count` sessões). */
  const mondays = (count = 4, firstDate = DAY) =>
    generateOccurrences({ firstDate, weekdays: [WEEKDAY], startTime: "14:00", durationMinutes: 50, count });
  const request = (over: Record<string, unknown> = {}, occurrences = mondays()) => ({
    patientId: ids.p1,
    professionalId: ids.pA,
    serviceId: ids.svc,
    occurrences,
    ...over,
  });
  const dayOf = (instant: Date) => instant.toISOString().slice(0, 10);

  async function sessionsOf(seriesId: string) {
    return owner<{ id: string; starts_at: Date; status: string; created_by: string }[]>`
      select id, starts_at, status, created_by from public.appointments where series_id = ${seriesId} order by starts_at`;
  }
  const counts = async () => {
    const patientIds = owner`select id from public.patients where full_name like ${`${TAG}%`}`;
    const [row] = await owner`select
      (select count(*) from public.appointment_series where patient_id in (${patientIds})) as series,
      (select count(*) from public.appointments where patient_id in (${patientIds})) as appointments,
      (select count(*) from public.patient_professionals where patient_id in (${patientIds})) as links`;
    return { series: Number(row!.series), appointments: Number(row!.appointments), links: Number(row!.links) };
  };

  describe("createSeries", () => {
    it("tudo livre: grava a série, todas as sessões, o valor do convênio e o vínculo, em nome de quem criou", async () => {
      await reset();
      const result = await createSeries(users.reception, request(), NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.created).toHaveLength(4);
      expect(result.skipped).toEqual([]);

      const [series] = await owner`select professional_id, patient_id, service_id, created_by from public.appointment_series where id = ${result.seriesId}`;
      expect(series).toMatchObject({ professional_id: ids.pA, patient_id: ids.p1, service_id: ids.svc, created_by: users.reception.userId });
      const sessions = await sessionsOf(result.seriesId);
      expect(sessions.map((row) => dayOf(row.starts_at))).toEqual(["2031-11-03", "2031-11-10", "2031-11-17", "2031-11-24"]);
      expect(sessions.every((row) => row.status === "scheduled" && row.created_by === users.reception.userId)).toBe(true);
      // p1 tem convênio: o valor do convênio é copiado para CADA sessão.
      const prices = await owner`select price_cents, insurance_id from public.appointment_prices where appointment_id = any(${sessions.map((row) => row.id)})`;
      expect(prices).toHaveLength(4);
      expect(prices.every((row) => row.price_cents === 10000 && row.insurance_id === ids.insurance)).toBe(true);
      expect(await counts()).toEqual({ series: 1, appointments: 4, links: 1 });
    });

    it("paciente particular: copia o valor particular", async () => {
      await reset();
      const result = await createSeries(users.admin, request({ patientId: ids.p2 }), NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const prices = await owner`select price_cents, insurance_id from public.appointment_prices where appointment_id in
        (select id from public.appointments where series_id = ${result.seriesId})`;
      expect(prices).toHaveLength(4);
      expect(prices.every((row) => row.price_cents === 15000 && row.insurance_id === null)).toBe(true);
    });

    it("uma data em folga: grava as outras 3 e diz qual pulou e por quê", async () => {
      await reset();
      await owner`insert into public.professional_time_off (professional_id, starts_at, ends_at)
        values (${ids.pA}, ${at("00:00", "2031-11-17")}, ${at("00:00", "2031-11-18")})`;
      const result = await createSeries(users.reception, request(), NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.created.map((item) => dayOf(item.startsAt))).toEqual(["2031-11-03", "2031-11-10", "2031-11-24"]);
      expect(result.skipped.map((item) => [dayOf(item.startsAt), item.reason])).toEqual([["2031-11-17", "time-off"]]);
      expect(await counts()).toEqual({ series: 1, appointments: 3, links: 1 });
    });

    it("conflito com outro atendimento do profissional ou do paciente: pula só aquela data", async () => {
      await reset();
      // O profissional A atende outro paciente em 11-10 às 14:00; o paciente 1 tem consulta com a Bia em 11-17 às 14:00.
      await owner`insert into public.appointments (professional_id, patient_id, service_id, specialty, starts_at, ends_at, created_by)
        values (${ids.pA}, ${ids.p2}, ${ids.svc}, 'physiotherapy', ${at("14:00", "2031-11-10")}, ${at("14:50", "2031-11-10")}, ${users.admin.userId}),
               (${ids.pB}, ${ids.p1}, ${ids.svc}, 'physiotherapy', ${at("14:00", "2031-11-17")}, ${at("14:50", "2031-11-17")}, ${users.admin.userId})`;
      const result = await createSeries(users.reception, request(), NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.created.map((item) => dayOf(item.startsAt))).toEqual(["2031-11-03", "2031-11-24"]);
      expect(result.skipped.map((item) => [dayOf(item.startsAt), item.reason])).toEqual([
        ["2031-11-10", "conflict-professional"],
        ["2031-11-17", "conflict-patient"],
      ]);
    });

    it("datas que já passaram são puladas como 'past'", async () => {
      await reset();
      const result = await createSeries(users.reception, request(), at("08:00", "2031-11-11"));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.created.map((item) => dayOf(item.startsAt))).toEqual(["2031-11-17", "2031-11-24"]);
      expect(result.skipped.map((item) => [dayOf(item.startsAt), item.reason])).toEqual([
        ["2031-11-03", "past"],
        ["2031-11-10", "past"],
      ]);
    });

    it("nenhuma data cabe: devolve 'nothing-fits' e NÃO grava nada (nem série, nem vínculo)", async () => {
      await reset();
      await owner`insert into public.professional_time_off (professional_id, starts_at, ends_at)
        values (${ids.pA}, ${at("00:00", "2031-11-02")}, ${at("00:00", "2031-12-02")})`;
      const result = await createSeries(users.reception, request(), NOW);
      expect(result).toEqual({ ok: false, reason: "nothing-fits" });
      expect(await counts()).toEqual({ series: 0, appointments: 0, links: 0 });
    });

    it("recusa serviço que o profissional não faz, profissional inativo e paciente removido, sem gravar nada", async () => {
      await reset();
      expect(await createSeries(users.reception, request({ serviceId: ids.svcNotOffered }), NOW)).toEqual({ ok: false, reason: "service-not-offered" });
      expect(await createSeries(users.reception, request({ professionalId: ids.pInactive }), NOW)).toEqual({ ok: false, reason: "not-found" });
      expect(await createSeries(users.reception, request({ patientId: ids.pRemoved }), NOW)).toEqual({ ok: false, reason: "not-found" });
      expect(await counts()).toEqual({ series: 0, appointments: 0, links: 0 });
    });

    it("o login de profissional não cria série (a RLS barra) e nada é gravado", async () => {
      await reset();
      const result = await createSeries(users.profA, request(), NOW);
      expect(result.ok).toBe(false);
      expect(await counts()).toEqual({ series: 0, appointments: 0, links: 0 });
    });

    it("duas séries disputando os mesmos horários nunca se sobrepõem: cada data tem um só vencedor", async () => {
      await reset();
      const [first, second] = await Promise.all([
        createSeries(users.reception, request({ patientId: ids.p1 }), NOW),
        createSeries(users.admin, request({ patientId: ids.p2 }), NOW),
      ]);
      const created = [first, second].flatMap((result) => (result.ok ? result.created : []));
      expect([first, second].some((result) => result.ok)).toBe(true);
      // Cada data da Ana às 14:00 tem exatamente UM atendimento, de quem venceu.
      const rows = await owner`select starts_at from public.appointments where professional_id = ${ids.pA} and patient_id in
        (select id from public.patients where full_name like ${`${TAG}%`}) order by starts_at`;
      expect(rows).toHaveLength(4);
      expect(new Set(rows.map((row) => dayOf(row.starts_at as Date))).size).toBe(4);
      expect(created.length).toBe(4);
      // Quem perdeu todas as datas recebe "nothing-fits"; quem perdeu algumas recebe a lista de puladas.
      for (const result of [first, second]) {
        if (!result.ok) expect(result.reason).toBe("nothing-fits");
      }
    }, 60_000);
  });

  describe("previewSeries", () => {
    it("classifica cada data (cabe, folga, conflito) sem gravar nada", async () => {
      await reset();
      await owner`insert into public.professional_time_off (professional_id, starts_at, ends_at)
        values (${ids.pA}, ${at("00:00", "2031-11-17")}, ${at("00:00", "2031-11-18")})`;
      await owner`insert into public.appointments (professional_id, patient_id, service_id, specialty, starts_at, ends_at, created_by)
        values (${ids.pA}, ${ids.p2}, ${ids.svc}, 'physiotherapy', ${at("14:00", "2031-11-10")}, ${at("14:50", "2031-11-10")}, ${users.admin.userId})`;
      const before = await counts();
      const result = await previewSeries(users.reception, request(), NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.items.map((item) => [dayOf(item.startsAt), item.verdict.ok ? "ok" : item.verdict.reason])).toEqual([
        ["2031-11-03", "ok"],
        ["2031-11-10", "conflict-professional"],
        ["2031-11-17", "time-off"],
        ["2031-11-24", "ok"],
      ]);
      expect(await counts()).toEqual(before);
    });

    it("devolve os mesmos motivos de recusa do pedido (serviço, profissional, paciente)", async () => {
      expect(await previewSeries(users.reception, request({ serviceId: ids.svcNotOffered }), NOW)).toEqual({ ok: false, reason: "service-not-offered" });
      expect(await previewSeries(users.reception, request({ patientId: ids.pRemoved }), NOW)).toEqual({ ok: false, reason: "not-found" });
    });
  });

  describe("renewSeries", () => {
    it("acrescenta sessões à MESMA série, com o mesmo padrão de recusa", async () => {
      await reset();
      const created = await createSeries(users.reception, request({}, mondays(2)), NOW);
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Renova com 11-10 (já existe: conflito) e as duas seguintes.
      const renewed = await renewSeries(users.reception, { seriesId: created.seriesId, occurrences: mondays(3, "2031-11-10") }, NOW);
      expect(renewed.ok).toBe(true);
      if (!renewed.ok) return;
      expect(renewed.seriesId).toBe(created.seriesId);
      expect(renewed.created.map((item) => dayOf(item.startsAt))).toEqual(["2031-11-17", "2031-11-24"]);
      expect(renewed.skipped.map((item) => [dayOf(item.startsAt), item.reason])).toEqual([["2031-11-10", "conflict-professional"]]);
      expect((await sessionsOf(created.seriesId)).map((row) => dayOf(row.starts_at))).toEqual(["2031-11-03", "2031-11-10", "2031-11-17", "2031-11-24"]);
      expect((await counts()).series).toBe(1);
    });

    it("série inexistente devolve 'not-found'", async () => {
      expect(await renewSeries(users.reception, { seriesId: randomUUID(), occurrences: mondays(2) }, NOW)).toEqual({ ok: false, reason: "not-found" });
    });
  });

  /** O estado atual das sessões de uma série: dia (UTC), hora de parede (minutos), duração e status. */
  async function layout(seriesId: string) {
    const rows = await owner<{ starts_at: Date; ends_at: Date; status: string; cancel_reason: string | null }[]>`
      select starts_at, ends_at, status, cancel_reason from public.appointments where series_id = ${seriesId} order by starts_at`;
    return rows.map((row) => ({
      day: dayOf(row.starts_at),
      time: row.starts_at.toISOString().slice(11, 16),
      minutes: (row.ends_at.getTime() - row.starts_at.getTime()) / 60_000,
      status: row.status,
      cancelReason: row.cancel_reason,
    }));
  }
  /** Brasília é UTC-3 em 2031 (sem horário de verão): 14:00 local = 17:00 UTC. */
  const T14 = "17:00";

  describe("cancelSeriesFrom", () => {
    it("cancela esta e as seguintes abertas (inclusive a confirmada), sem tocar nas anteriores nem nas fechadas", async () => {
      await reset();
      const created = await createSeries(users.reception, request(), NOW);
      if (!created.ok) throw new Error("fixture");
      const [s1, s2, s3, s4] = created.created.map((item) => item.id) as [string, string, string, string];
      // O dono ajusta o estado (o gatilho não restringe o dono): a 1ª já realizada, a 4ª confirmada.
      await owner`update public.appointments set status = 'done' where id = ${s1}`;
      await owner`update public.appointments set status = 'confirmed' where id = ${s4}`;

      const result = await cancelSeriesFrom(users.reception, { id: s3, reason: "[teste] paciente desistiu" });
      expect(result).toEqual({ ok: true, count: 2 });
      expect((await layout(created.seriesId)).map((row) => [row.day, row.status, row.cancelReason])).toEqual([
        ["2031-11-03", "done", null],
        ["2031-11-10", "scheduled", null],
        ["2031-11-17", "cancelled", "[teste] paciente desistiu"],
        ["2031-11-24", "cancelled", "[teste] paciente desistiu"],
      ]);
      void s2;
    });

    it("cancelar a primeira cancela a série toda; o horário fica livre para outro paciente", async () => {
      await reset();
      const created = await createSeries(users.admin, request(), NOW);
      if (!created.ok) throw new Error("fixture");
      expect(await cancelSeriesFrom(users.admin, { id: created.created[0]!.id, reason: "[teste] encerrada" })).toEqual({ ok: true, count: 4 });
      const again = await createSeries(users.reception, request({ patientId: ids.p2 }), NOW);
      expect(again.ok && again.created.length).toBe(4);
    });

    it("sessão avulsa, inexistente ou já cancelada: recusa sem mexer em nada", async () => {
      await reset();
      const [loose] = await owner`insert into public.appointments (professional_id, patient_id, service_id, specialty, starts_at, ends_at, created_by)
        values (${ids.pA}, ${ids.p1}, ${ids.svc}, 'physiotherapy', ${at("14:00", "2031-12-08")}, ${at("14:50", "2031-12-08")}, ${users.admin.userId}) returning id`;
      expect(await cancelSeriesFrom(users.reception, { id: loose!.id as string, reason: "[teste] x" })).toEqual({ ok: false, reason: "not-found" });
      expect(await cancelSeriesFrom(users.reception, { id: randomUUID(), reason: "[teste] x" })).toEqual({ ok: false, reason: "not-found" });

      const created = await createSeries(users.reception, request(), NOW);
      if (!created.ok) throw new Error("fixture");
      await cancelSeriesFrom(users.reception, { id: created.created[0]!.id, reason: "[teste] primeira vez" });
      expect(await cancelSeriesFrom(users.reception, { id: created.created[0]!.id, reason: "[teste] de novo" })).toEqual({ ok: false, reason: "changed" });
    });

    it("o profissional não cancela (o gatilho barra) e nada muda", async () => {
      await reset();
      const created = await createSeries(users.reception, request(), NOW);
      if (!created.ok) throw new Error("fixture");
      const result = await cancelSeriesFrom(users.profA, { id: created.created[0]!.id, reason: "[teste] x" });
      expect(result.ok).toBe(false);
      expect((await layout(created.seriesId)).every((row) => row.status === "scheduled")).toBe(true);
    });
  });

  describe("rescheduleSeriesFrom", () => {
    const bia = (weekdays: number[], count: number, first = DAY) =>
      request(
        { professionalId: ids.pB, patientId: ids.p2 },
        generateOccurrences({ firstDate: first, weekdays, startTime: "14:00", durationMinutes: 50, count }),
      );
    const move = (id: string, day: string, time: string, minutes = 50) => ({ id, startsAt: at(time, day), endsAt: new Date(at(time, day).getTime() + minutes * 60_000) });

    it("muda o horário desta e das seguintes (mesmo dia), com a nova duração; as anteriores ficam", async () => {
      await reset();
      const created = await createSeries(users.reception, bia([WEEKDAY], 4), NOW);
      if (!created.ok) throw new Error("fixture");
      const result = await rescheduleSeriesFrom(users.reception, move(created.created[1]!.id, "2031-11-10", "15:00", 40), NOW);
      expect(result.ok).toBe(true);
      expect((await layout(created.seriesId)).map((row) => [row.day, row.time, row.minutes])).toEqual([
        ["2031-11-03", T14, 50],
        ["2031-11-10", "18:00", 40],
        ["2031-11-17", "18:00", 40],
        ["2031-11-24", "18:00", 40],
      ]);
    });

    it("muda o dia: todas as seguintes andam o mesmo número de dias, e a confirmada volta a Agendada", async () => {
      await reset();
      const created = await createSeries(users.reception, bia([WEEKDAY], 4), NOW);
      if (!created.ok) throw new Error("fixture");
      await owner`update public.appointments set status = 'confirmed' where id = ${created.created[2]!.id}`;
      // A 2ª sessão passa da segunda 11-10 para a terça 11-11 (+1 dia).
      const result = await rescheduleSeriesFrom(users.reception, move(created.created[1]!.id, "2031-11-11", "14:00"), NOW);
      expect(result.ok && result.moved.map((item) => dayOf(item.startsAt))).toEqual(["2031-11-11", "2031-11-18", "2031-11-25"]);
      expect(result.ok && result.skipped).toEqual([]);
      expect((await layout(created.seriesId)).map((row) => [row.day, row.status])).toEqual([
        ["2031-11-03", "scheduled"],
        ["2031-11-11", "scheduled"],
        ["2031-11-18", "scheduled"],
        ["2031-11-25", "scheduled"],
      ]);
    });

    it("+2 dias sobre uma série segunda/quarta: cada sessão cai no lugar que a seguinte já liberou", async () => {
      await reset();
      const wednesday = (WEEKDAY + 2) % 7;
      const created = await createSeries(users.reception, bia([WEEKDAY, wednesday], 4), NOW);
      if (!created.ok) throw new Error("fixture");
      expect((await layout(created.seriesId)).map((row) => row.day)).toEqual(["2031-11-03", "2031-11-05", "2031-11-10", "2031-11-12"]);
      // A 1ª (segunda 11-03) vai para a quarta 11-05: exatamente onde a 2ª está.
      const result = await rescheduleSeriesFrom(users.reception, move(created.created[0]!.id, "2031-11-05", "14:00"), NOW);
      expect(result.ok && result.skipped).toEqual([]);
      expect((await layout(created.seriesId)).map((row) => row.day)).toEqual(["2031-11-05", "2031-11-07", "2031-11-12", "2031-11-14"]);
    });

    it("para trás (-2 dias): também sem colidir com as irmãs", async () => {
      await reset();
      const wednesday = (WEEKDAY + 2) % 7;
      const created = await createSeries(users.reception, bia([WEEKDAY, wednesday], 4, "2031-11-05"), NOW);
      if (!created.ok) throw new Error("fixture");
      expect((await layout(created.seriesId)).map((row) => row.day)).toEqual(["2031-11-05", "2031-11-10", "2031-11-12", "2031-11-17"]);
      const result = await rescheduleSeriesFrom(users.reception, move(created.created[0]!.id, "2031-11-03", "14:00"), NOW);
      expect(result.ok && result.skipped).toEqual([]);
      expect((await layout(created.seriesId)).map((row) => row.day)).toEqual(["2031-11-03", "2031-11-08", "2031-11-10", "2031-11-15"]);
    });

    it("a sessão que não cabe (folga) fica onde está e é listada; as outras andam", async () => {
      await reset();
      const created = await createSeries(users.reception, bia([WEEKDAY], 4), NOW);
      if (!created.ok) throw new Error("fixture");
      await owner`insert into public.professional_time_off (professional_id, starts_at, ends_at)
        values (${ids.pB}, ${at("00:00", "2031-11-25")}, ${at("00:00", "2031-11-26")})`;
      const result = await rescheduleSeriesFrom(users.reception, move(created.created[1]!.id, "2031-11-11", "14:00"), NOW);
      expect(result.ok && result.moved.map((item) => dayOf(item.startsAt))).toEqual(["2031-11-11", "2031-11-18"]);
      expect(result.ok && result.skipped.map((item) => [dayOf(item.from), dayOf(item.to), item.reason])).toEqual([["2031-11-24", "2031-11-25", "time-off"]]);
      expect((await layout(created.seriesId)).map((row) => row.day)).toEqual(["2031-11-03", "2031-11-11", "2031-11-18", "2031-11-24"]);
    });

    it("se a própria sessão escolhida não cabe, recusa com o motivo e NÃO move nenhuma", async () => {
      await reset();
      const created = await createSeries(users.reception, bia([WEEKDAY], 3), NOW);
      if (!created.ok) throw new Error("fixture");
      const before = await layout(created.seriesId);
      // 22:00 está fora do atendimento da Bia (08:00 às 18:00).
      expect(await rescheduleSeriesFrom(users.reception, move(created.created[1]!.id, "2031-11-10", "22:00"), NOW)).toEqual({ ok: false, reason: "outside-grid" });
      expect(await layout(created.seriesId)).toEqual(before);
    });

    it("sessão avulsa, fechada ou inexistente: recusa; o profissional não remarca", async () => {
      await reset();
      expect(await rescheduleSeriesFrom(users.reception, move(randomUUID(), DAY, "15:00"), NOW)).toEqual({ ok: false, reason: "not-found" });
      const created = await createSeries(users.reception, bia([WEEKDAY], 3), NOW);
      if (!created.ok) throw new Error("fixture");
      await owner`update public.appointments set status = 'done' where id = ${created.created[0]!.id}`;
      expect(await rescheduleSeriesFrom(users.reception, move(created.created[0]!.id, "2031-11-03", "15:00"), NOW)).toEqual({ ok: false, reason: "changed" });
    });
  });

  describe("previewRenewal", () => {
    it("classifica as datas da renovação sobre a série existente, sem gravar", async () => {
      await reset();
      const created = await createSeries(users.reception, request({}, mondays(2)), NOW);
      if (!created.ok) throw new Error("fixture");
      const before = await counts();
      const result = await previewRenewal(users.reception, { seriesId: created.seriesId, occurrences: mondays(3, "2031-11-10") }, NOW);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.items.map((item) => [dayOf(item.startsAt), item.verdict.ok ? "ok" : item.verdict.reason])).toEqual([
        ["2031-11-10", "conflict-professional"],
        ["2031-11-17", "ok"],
        ["2031-11-24", "ok"],
      ]);
      expect(await counts()).toEqual(before);
      expect(await previewRenewal(users.reception, { seriesId: randomUUID(), occurrences: mondays(2) }, NOW)).toEqual({ ok: false, reason: "not-found" });
    });
  });

  describe("consultas da agenda: série e andamento", () => {
    const window = { from: at("00:00", "2031-11-02"), to: at("00:00", "2031-12-02") };

    it("a equipe recebe a série e o andamento (realizadas, faltas, restantes, canceladas) e a posição de cada sessão", async () => {
      await reset();
      const created = await createSeries(users.reception, request(), NOW);
      if (!created.ok) throw new Error("fixture");
      const [s1, s2, s3] = created.created.map((item) => item.id) as [string, string, string, string];
      await owner`update public.appointments set status = 'done' where id = ${s1}`;
      await owner`update public.appointments set status = 'no_show' where id = ${s2}`;
      await owner`update public.appointments set status = 'cancelled', cancel_reason = '[teste] x' where id = ${s3}`;

      for (const [user, role] of [
        [users.reception, "reception"],
        [users.admin, "admin"],
      ] as const) {
        const items = await listAppointments(user, { ...window, professionalId: ids.pA, role });
        const mine = items.filter((item) => item.series?.id === created.seriesId);
        expect(mine).toHaveLength(4);
        const last = mine.find((item) => dayOf(item.startsAt) === "2031-11-24");
        expect(last?.series).toEqual({ id: created.seriesId, position: 3, total: 3, done: 1, noShow: 1, remaining: 1, cancelled: 1 });
        // A cancelada não tem posição.
        expect(mine.find((item) => item.id === s3)?.series?.position).toBeNull();
        expect((await getAppointment(user, s1, { role }))?.series).toMatchObject({ id: created.seriesId, position: 1, total: 3 });
      }
    });

    it("atendimento avulso não tem série", async () => {
      await reset();
      const [loose] = await owner`insert into public.appointments (professional_id, patient_id, service_id, specialty, starts_at, ends_at, created_by)
        values (${ids.pA}, ${ids.p1}, ${ids.svc}, 'physiotherapy', ${at("14:00", "2031-11-10")}, ${at("14:50", "2031-11-10")}, ${users.admin.userId}) returning id`;
      const item = await getAppointment(users.reception, loose!.id as string, { role: "reception" });
      expect(item?.series ?? null).toBeNull();
    });

    it("o profissional vê as próprias sessões, mas NUNCA a série nem o id dela", async () => {
      await reset();
      const created = await createSeries(users.reception, request(), NOW);
      if (!created.ok) throw new Error("fixture");
      // O vínculo paciente↔profissional já foi criado pela série: o profissional lê o paciente.
      const items = await listAppointments(users.profA, { ...window, role: "professional" });
      expect(items).toHaveLength(4);
      for (const item of items) expect(item.series ?? null).toBeNull();
      const one = await getAppointment(users.profA, created.created[0]!.id, { role: "professional" });
      expect(one?.series ?? null).toBeNull();
      // Nem o id da série escapa pelo objeto inteiro (vai para o HTML da tela).
      expect(JSON.stringify([items, one])).not.toContain(created.seriesId);
    });

    it("sem nenhuma série na tela, não faz a consulta extra de andamento", async () => {
      await reset();
      const items = await listAppointments(users.reception, { ...window, professionalId: ids.pA, role: "reception" });
      expect(items).toEqual([]);
    });
  });

  describe("achados da revisão independente", () => {
    it("o relógio do BANCO já passou das datas (o do app está atrasado): vira data pulada 'past', não falha geral", async () => {
      await reset();
      // O pedido acha que ainda é 2024-01-01; para o banco, 2024-06-03 e 2024-06-10 (segundas) já passaram.
      const occurrences = generateOccurrences({ firstDate: "2024-06-03", weekdays: [WEEKDAY], startTime: "14:00", durationMinutes: 50, count: 2 });
      expect(await createSeries(users.reception, request({}, occurrences), new Date("2024-01-01T12:00:00Z"))).toEqual({ ok: false, reason: "nothing-fits" });
      expect(await counts()).toEqual({ series: 0, appointments: 0, links: 0 });
    });

    it("se uma sessão muda DEPOIS de lida e antes de gravada, a remarcação recusa ('changed') e não move nenhuma", async () => {
      await reset();
      const created = await createSeries(users.reception, request({ professionalId: ids.pB, patientId: ids.p2 }, mondays(4)), NOW);
      if (!created.ok) throw new Error("fixture");
      const [, anchor, , last] = created.created.map((item) => item.id) as [string, string, string, string];
      const before = await layout(created.seriesId);
      const target = { id: anchor, startsAt: at("15:00", "2031-11-11"), endsAt: at("15:50", "2031-11-11") };

      // O dono SEGURA a linha da última sessão. Remarcar para a frente grava da última para a primeira,
      // então o primeiro UPDATE bloqueia nela, depois de a remarcação já ter LIDO as sessões.
      const { pending } = await owner.begin(async (hold) => {
        await hold`select id from public.appointments where id = ${last} for update`;
        const pending = rescheduleSeriesFrom(users.reception, target, NOW);
        // Dá tempo de a remarcação LER as sessões e ficar bloqueada no UPDATE. Fica bem abaixo do
        // `lock_timeout` de 5 s do papel do app (acima disso o UPDATE falharia com 55P03). O dono não
        // enxerga a espera de outro papel em `pg_stat_activity`, então não dá para sondar.
        await new Promise((resolve) => setTimeout(resolve, 3500));
        // Outra pessoa muda a sessão por fora (o dono não é restringido pelo gatilho) e libera a linha.
        await hold`update public.appointments set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id = ${last}`;
        // Envolvido num objeto de propósito: devolver a promessa direto faria o `begin` esperá-la ANTES do
        // commit, e a remarcação ficaria presa na trava que só o commit libera.
        return { pending };
      });

      expect(await pending).toEqual({ ok: false, reason: "changed" });
      const after = await layout(created.seriesId);
      // Nada foi movido (a transação inteira foi desfeita); só a mudança de fora aparece, na última.
      expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
      expect(after[3]?.time).not.toBe(before[3]?.time);
    }, 60_000);

    it("renovar depois de o paciente mudar de convênio copia o valor ATUAL (particular), sem mexer nas antigas", async () => {
      await reset();
      const created = await createSeries(users.reception, request({}, mondays(2)), NOW);
      if (!created.ok) throw new Error("fixture");
      await owner`update public.patient_private set insurance_id = null where patient_id = ${ids.p1}`;
      try {
        const renewed = await renewSeries(users.reception, { seriesId: created.seriesId, occurrences: mondays(2, "2031-11-17") }, NOW);
        expect(renewed.ok && renewed.created).toHaveLength(2);
        const rows = await owner`select a.starts_at, ap.price_cents, ap.insurance_id from public.appointments a
          join public.appointment_prices ap on ap.appointment_id = a.id where a.series_id = ${created.seriesId} order by a.starts_at`;
        expect(rows.map((row) => [dayOf(row.starts_at as Date), row.price_cents, row.insurance_id])).toEqual([
          ["2031-11-03", 10000, ids.insurance],
          ["2031-11-10", 10000, ids.insurance],
          ["2031-11-17", 15000, null],
          ["2031-11-24", 15000, null],
        ]);
      } finally {
        await owner`update public.patient_private set insurance_id = ${ids.insurance} where patient_id = ${ids.p1}`;
      }
    });
  });
});

