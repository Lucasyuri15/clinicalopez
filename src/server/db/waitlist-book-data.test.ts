import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { zonedToUtc } from "@/lib/datetime";
import { weekdayOf } from "@/lib/schedule/calendar";
import { bookFromWaitlist } from "@/server/waitlist/book";
import { removeEntry } from "@/server/waitlist/mutations";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Agendar a partir da lista de espera (Fase 3B-2) contra o Supabase DEV pelo caminho REAL do app
 * (`withUser` → `authenticated` sob RLS). Só dados FICTÍCIOS, commitados pelo dono e apagados no fim.
 * Prova que agendar da espera é UMA transação (atendimento, valor, vínculo e espera `fulfilled`
 * juntos ou nada), que a duração vem do serviço (o cliente não a informa), que grade, folga, passado
 * e conflito valem como no agendamento comum e que as corridas terminam com um vencedor só.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-agendar-espera ${randomUUID().slice(0, 8)}]`;
const DAY = "2031-09-08";
const WEEKDAY = weekdayOf(DAY);
const at = (time: string, day = DAY) => zonedToUtc(day, time);
const NOW = at("00:00", "2031-08-01");

describe.skipIf(!hasDb)("agendar a partir da lista de espera (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = {
    admin: { userId: randomUUID() },
    reception: { userId: randomUUID() },
    profA: { userId: randomUUID() },
  };
  const ids = { pA: "", pB: "", svc: "", svc2: "", svcOnlyA: "", p1: "", p2: "", pRemoved: "", pOther: "" };

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`agendar-espera-${key}-${userId}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role) values
        (${users.admin.userId}, ${`${TAG} Admin`}, 'admin'),
        (${users.reception.userId}, ${`${TAG} Recepcao`}, 'reception'),
        (${users.profA.userId}, ${`${TAG} Login A`}, 'professional')`;
      const pros = await owner`insert into public.professionals (full_name, specialty, profile_id, active) values
        (${`${TAG} Ana`}, 'physiotherapy', ${users.profA.userId}, true),
        (${`${TAG} Bia`}, 'physiotherapy', null, true) returning id`;
      [ids.pA, ids.pB] = pros.map((row) => row.id as string) as [string, string];
      const svcs = await owner`insert into public.services (name, specialty, duration_minutes, active) values
        (${`${TAG} Sessao`}, 'physiotherapy', 50, true),
        (${`${TAG} Avaliacao`}, 'physiotherapy', 60, true),
        (${`${TAG} So da Ana`}, 'physiotherapy', 30, true) returning id`;
      [ids.svc, ids.svc2, ids.svcOnlyA] = svcs.map((row) => row.id as string) as [string, string, string];
      await owner`insert into public.professional_services (professional_id, service_id, specialty) values
        (${ids.pA}, ${ids.svc}, 'physiotherapy'), (${ids.pA}, ${ids.svc2}, 'physiotherapy'),
        (${ids.pA}, ${ids.svcOnlyA}, 'physiotherapy'), (${ids.pB}, ${ids.svc}, 'physiotherapy'),
        (${ids.pB}, ${ids.svc2}, 'physiotherapy')`;
      await owner`insert into public.service_prices (service_id, insurance_id, price_cents) values (${ids.svc}, null, 15000)`;
      const pats = await owner`insert into public.patients (full_name, birth_date, deleted_at) values
        (${`${TAG} Paciente 1`}, '1990-05-10', null), (${`${TAG} Paciente 2`}, '1985-03-02', null),
        (${`${TAG} Paciente Removido`}, '1999-09-09', now()), (${`${TAG} Paciente Outro`}, '1970-01-01', null) returning id`;
      [ids.p1, ids.p2, ids.pRemoved, ids.pOther] = pats.map((row) => row.id as string) as [string, string, string, string];
      await owner`insert into public.patient_private (patient_id, no_cpf_reason, insurance_id) values
        (${ids.p1}, '[teste] sem cpf', null), (${ids.p2}, '[teste] sem cpf', null),
        (${ids.pOther}, '[teste] sem cpf', null)`;
      // A Ana trabalha 08:00–12:00 e 14:00–18:00; a Bia, o dia todo.
      await owner`insert into public.professional_work_hours (professional_id, weekday, start_minute, end_minute) values
        (${ids.pA}, ${WEEKDAY}, 480, 720), (${ids.pA}, ${WEEKDAY}, 840, 1080), (${ids.pB}, ${WEEKDAY}, 480, 1080)`;
    } catch (error) {
      await cleanup();
      throw error;
    }
  });

  async function cleanup() {
    const like = `${TAG}%`;
    const patientIds = owner`select id from public.patients where full_name like ${like}`;
    await owner`delete from public.waitlist_entries where patient_id in (${patientIds})`;
    await owner`delete from public.appointment_prices where appointment_id in
      (select id from public.appointments where patient_id in (${patientIds}))`;
    await owner`delete from public.appointments where patient_id in (${patientIds})`;
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

  beforeEach(async () => {
    const patientIds = owner`select id from public.patients where full_name like ${`${TAG}%`}`;
    await owner`delete from public.waitlist_entries where patient_id in (${patientIds})`;
    await owner`delete from public.appointment_prices where appointment_id in
      (select id from public.appointments where patient_id in (${patientIds}))`;
    await owner`delete from public.appointments where patient_id in (${patientIds})`;
    await owner`delete from public.patient_professionals where patient_id in (${patientIds})`;
    await owner`delete from public.professional_time_off where professional_id in
      (select id from public.professionals where full_name like ${`${TAG}%`})`;
  });

  async function entry(over: { patientId?: string; serviceId?: string; professionalId?: string | null; status?: "waiting" | "removed" } = {}) {
    const removed = over.status === "removed";
    const [row] = await owner`insert into public.waitlist_entries
      (patient_id, service_id, professional_id, specialty, status, closed_at, closed_by, created_by)
      values (${over.patientId ?? ids.p1}, ${over.serviceId ?? ids.svc}, ${over.professionalId ?? null}, 'physiotherapy',
        ${over.status ?? "waiting"}, ${removed ? new Date() : null}, ${removed ? users.admin.userId : null}, ${users.admin.userId})
      returning id`;
    return row!.id as string;
  }
  const entryRow = async (id: string) => (await owner`select * from public.waitlist_entries where id = ${id}`)[0];
  const appointmentsOf = async (patientId: string) =>
    await owner`select * from public.appointments where patient_id = ${patientId} order by starts_at`;
  const book = (entryId: string, time: string, over: { professionalId?: string; user?: { userId: string }; now?: Date } = {}) =>
    bookFromWaitlist(
      over.user ?? users.reception,
      { entryId, professionalId: over.professionalId ?? ids.pA, startsAt: at(time) },
      over.now ?? NOW,
    );

  it("agenda: atendimento, valor, vínculo e espera atendida, tudo junto", async () => {
    const id = await entry({ patientId: ids.p1, serviceId: ids.svc });
    const result = await book(id, "09:00");
    expect(result.ok).toBe(true);
    const appointmentId = (result as { id: string }).id;

    const [appointment] = await appointmentsOf(ids.p1);
    expect(appointment).toMatchObject({
      id: appointmentId,
      professional_id: ids.pA,
      service_id: ids.svc,
      specialty: "physiotherapy",
      status: "scheduled",
      created_by: users.reception.userId,
    });
    expect(appointment!.starts_at).toEqual(at("09:00"));
    expect(appointment!.ends_at).toEqual(at("09:50"));
    const [price] = await owner`select * from public.appointment_prices where appointment_id = ${appointmentId}`;
    expect(price).toMatchObject({ price_cents: 15000, insurance_id: null });
    const links = await owner`select 1 from public.patient_professionals where patient_id = ${ids.p1} and professional_id = ${ids.pA}`;
    expect(links).toHaveLength(1);
    expect(await entryRow(id)).toMatchObject({
      status: "fulfilled",
      appointment_id: appointmentId,
      closed_by: users.reception.userId,
    });
  });

  it("a duração é a do SERVIÇO da espera (o pedido só traz o início)", async () => {
    const id = await entry({ patientId: ids.p1, serviceId: ids.svc2 });
    expect((await book(id, "09:00")).ok).toBe(true);
    expect((await appointmentsOf(ids.p1))[0]!.ends_at).toEqual(at("10:00"));
  });

  it("espera que pede um profissional só agenda com ele; 'qualquer' aceita outro que ofereça o serviço", async () => {
    const pinned = await entry({ patientId: ids.p1, professionalId: ids.pA });
    expect(await book(pinned, "09:00", { professionalId: ids.pB })).toEqual({ ok: false, reason: "not-found" });
    expect((await entryRow(pinned))!.status).toBe("waiting");
    expect(await appointmentsOf(ids.p1)).toHaveLength(0);

    const any = await entry({ patientId: ids.p2, professionalId: null });
    expect((await book(any, "09:00", { professionalId: ids.pB })).ok).toBe(true);
    expect((await appointmentsOf(ids.p2))[0]!.professional_id).toBe(ids.pB);
  });

  it("profissional que não oferece o serviço: service-not-offered, nada gravado", async () => {
    const id = await entry({ patientId: ids.p1, serviceId: ids.svcOnlyA });
    expect(await book(id, "09:00", { professionalId: ids.pB })).toEqual({ ok: false, reason: "service-not-offered" });
    expect(await appointmentsOf(ids.p1)).toHaveLength(0);
    expect((await entryRow(id))!.status).toBe("waiting");
  });

  it.each([
    ["fora da grade (almoço)", "12:30", "outside-grid"],
    ["horário que já passou", "09:00", "past"],
  ] as const)("recusa %s e não deixa nada para trás", async (_label, time, reason) => {
    const id = await entry({ patientId: ids.p1 });
    const now = reason === "past" ? at("09:01") : NOW;
    expect(await book(id, time, { now })).toEqual({ ok: false, reason });
    expect(await appointmentsOf(ids.p1)).toHaveLength(0);
    expect((await entryRow(id))).toMatchObject({ status: "waiting", appointment_id: null });
  });

  it("recusa folga do profissional", async () => {
    await owner`insert into public.professional_time_off (professional_id, starts_at, ends_at) values (${ids.pA}, ${at("09:30")}, ${at("10:00")})`;
    const id = await entry({ patientId: ids.p1 });
    expect(await book(id, "09:00")).toEqual({ ok: false, reason: "time-off" });
    expect(await appointmentsOf(ids.p1)).toHaveLength(0);
  });

  it("conflito do profissional e do paciente vêm do BANCO; a espera continua aberta", async () => {
    await owner`insert into public.appointments (professional_id, patient_id, service_id, specialty, starts_at, ends_at, created_by)
      values (${ids.pA}, ${ids.pOther}, ${ids.svc}, 'physiotherapy', ${at("09:30")}, ${at("10:20")}, ${users.admin.userId})`;
    const proBusy = await entry({ patientId: ids.p1 });
    expect(await book(proBusy, "09:00")).toEqual({ ok: false, reason: "conflict-professional" });

    // O paciente 2 já tem outro atendimento (com a Bia) naquela hora.
    await owner`insert into public.appointments (professional_id, patient_id, service_id, specialty, starts_at, ends_at, created_by)
      values (${ids.pB}, ${ids.p2}, ${ids.svc}, 'physiotherapy', ${at("14:00")}, ${at("14:50")}, ${users.admin.userId})`;
    const patientBusy = await entry({ patientId: ids.p2 });
    expect(await book(patientBusy, "14:00")).toEqual({ ok: false, reason: "conflict-patient" });

    expect(await appointmentsOf(ids.p1)).toHaveLength(0);
    expect((await entryRow(proBusy))!.status).toBe("waiting");
    expect((await entryRow(patientBusy))!.status).toBe("waiting");
  });

  it("espera já encerrada: changed e nenhum atendimento; espera inexistente: not-found", async () => {
    const closed = await entry({ patientId: ids.p1, status: "removed" });
    expect(await book(closed, "09:00")).toEqual({ ok: false, reason: "changed" });
    expect(await appointmentsOf(ids.p1)).toHaveLength(0);
    expect(await book(randomUUID(), "09:00")).toEqual({ ok: false, reason: "not-found" });
  });

  it("paciente removido: not-found vindo da conferência do paciente", async () => {
    const id = await entry({ patientId: ids.pRemoved });
    // O ADMIN enxerga a espera de um paciente removido (a RLS da recepção a esconde e o not-found
    // viria da leitura da espera): aqui quem recusa é a conferência do paciente.
    expect(await book(id, "09:00", { user: users.admin })).toEqual({ ok: false, reason: "not-found" });
    expect(await appointmentsOf(ids.pRemoved)).toHaveLength(0);
    expect((await entryRow(id))!.status).toBe("waiting");
    // A recepção também não agenda (a espera nem aparece para ela).
    expect(await book(id, "09:00")).toEqual({ ok: false, reason: "not-found" });
  });

  it("o profissional não agenda (não vê a espera)", async () => {
    const id = await entry({ patientId: ids.p1 });
    expect(await book(id, "09:00", { user: users.profA })).toEqual({ ok: false, reason: "not-found" });
    expect(await appointmentsOf(ids.p1)).toHaveLength(0);
    expect((await entryRow(id))!.status).toBe("waiting");
  });

  it("espera encerrada DEPOIS da leitura: changed e o atendimento é desfeito (o fechamento só vale se ainda aguarda)", async () => {
    const id = await entry({ patientId: ids.p1 });
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let removal!: ReturnType<typeof removeEntry>;
    let booking!: ReturnType<typeof book>;
    // Ordem DETERMINÍSTICA: o dono segura a linha da espera; a retirada entra primeiro na fila do
    // bloqueio; o agendamento lê a espera ainda aguardando, grava o atendimento e para no fechamento.
    // Ao soltar, a retirada vence e o fechamento do agendamento encontra a espera já encerrada.
    // Quem recusa é o `WHERE status = 'waiting'` do app E a política de UPDATE (USING só "waiting",
    // reavaliada após a espera pelo bloqueio): as duas dão 0 linhas, então este teste prova o
    // COMPORTAMENTO (changed + atendimento desfeito), não cada barreira sozinha.
    await owner.begin(async (sql) => {
      await sql`select id from public.waitlist_entries where id = ${id} for update`;
      removal = removeEntry(users.admin, { id });
      await sleep(1500);
      booking = book(id, "09:00");
      await sleep(2500);
    });
    expect((await removal).ok).toBe(true);
    expect(await booking).toEqual({ ok: false, reason: "changed" });
    expect(await appointmentsOf(ids.p1)).toHaveLength(0);
    expect((await entryRow(id))).toMatchObject({ status: "removed", appointment_id: null });
  }, 30_000);

  it("corrida: a MESMA espera em dois horários agenda uma vez só e desfaz o atendimento da perdedora", async () => {
    const id = await entry({ patientId: ids.p1 });
    const [one, two] = await Promise.all([book(id, "09:00"), book(id, "11:00", { user: users.admin })]);
    expect([one.ok, two.ok].filter(Boolean)).toHaveLength(1);
    const loser = one.ok ? two : one;
    expect(loser).toEqual({ ok: false, reason: "changed" });
    expect(await appointmentsOf(ids.p1)).toHaveLength(1);
    const [row] = await owner`select count(*)::int as n from public.appointment_prices where appointment_id in
      (select id from public.appointments where patient_id = ${ids.p1})`;
    expect(row!.n).toBe(1);
  });

  it("corrida: duas esperas no MESMO horário, uma vence e a outra continua na lista", async () => {
    const first = await entry({ patientId: ids.p1 });
    const second = await entry({ patientId: ids.p2 });
    const [one, two] = await Promise.all([book(first, "09:00"), book(second, "09:00", { user: users.admin })]);
    expect([one.ok, two.ok].filter(Boolean)).toHaveLength(1);
    expect(one.ok ? two : one).toEqual({ ok: false, reason: "conflict-professional" });
    const statuses = [(await entryRow(first))!.status, (await entryRow(second))!.status].sort();
    expect(statuses).toEqual(["fulfilled", "waiting"]);
  });
});
