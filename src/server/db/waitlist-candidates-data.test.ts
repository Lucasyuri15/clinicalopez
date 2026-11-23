import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { zonedToUtc } from "@/lib/datetime";
import { weekdayOf } from "@/lib/schedule/calendar";
import { findCandidates } from "@/server/waitlist/candidates";

import { assertMigrationTarget } from "./migration-guard";

/**
 * Candidatos da lista de espera para um horário que vagou (Fase 3B-2) contra o Supabase DEV pelo
 * caminho REAL do app (`withUser` → `authenticated` sob RLS). Só dados FICTÍCIOS, commitados pelo dono
 * e apagados no fim. Prova que só entra quem CABE de verdade (preferência, serviço oferecido, grade,
 * folga e conflito do profissional e do paciente), na ordem de chegada e com teto de 10.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const TAG = `[teste-candidatos ${randomUUID().slice(0, 8)}]`;
const DAY = "2031-09-01";
const WEEKDAY = weekdayOf(DAY);
const at = (time: string, day = DAY) => zonedToUtc(day, time);
const NOW = at("00:00", "2031-08-01");

describe.skipIf(!hasDb)("candidatos da lista de espera (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const users = {
    admin: { userId: randomUUID() },
    reception: { userId: randomUUID() },
    profA: { userId: randomUUID() },
  };
  const ids = {
    pA: "", pB: "", pDent: "",
    svc: "", svc2: "", svcInactive: "", svcDent: "",
    p1: "", p2: "", p3: "", pRemoved: "", pOther: "",
  };
  /** O horário que vagou: 09:00–09:50 da Ana. */
  const freed = () => ({
    professionalId: ids.pA,
    specialty: "physiotherapy" as const,
    startsAt: at("09:00"),
    endsAt: at("09:50"),
  });

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1 });
    try {
      for (const [key, { userId }] of Object.entries(users)) {
        await owner`insert into auth.users (id, aud, role, email)
          values (${userId}, 'authenticated', 'authenticated', ${`candidatos-${key}-${userId}@teste.invalid`})`;
      }
      await owner`insert into public.profiles (id, full_name, role) values
        (${users.admin.userId}, ${`${TAG} Admin`}, 'admin'),
        (${users.reception.userId}, ${`${TAG} Recepcao`}, 'reception'),
        (${users.profA.userId}, ${`${TAG} Login A`}, 'professional')`;
      const pros = await owner`insert into public.professionals (full_name, specialty, profile_id, active) values
        (${`${TAG} Ana`}, 'physiotherapy', ${users.profA.userId}, true),
        (${`${TAG} Bia`}, 'physiotherapy', null, true),
        (${`${TAG} Dente`}, 'dentistry', null, true) returning id`;
      [ids.pA, ids.pB, ids.pDent] = pros.map((row) => row.id as string) as [string, string, string];
      const svcs = await owner`insert into public.services (name, specialty, duration_minutes, active) values
        (${`${TAG} Sessao`}, 'physiotherapy', 50, true),
        (${`${TAG} Avaliacao`}, 'physiotherapy', 60, true),
        (${`${TAG} Inativo`}, 'physiotherapy', 30, false),
        (${`${TAG} Limpeza`}, 'dentistry', 40, true) returning id`;
      [ids.svc, ids.svc2, ids.svcInactive, ids.svcDent] = svcs.map((row) => row.id as string) as [string, string, string, string];
      // A Ana oferece Sessão, Avaliação e o serviço inativo; a Bia só a Sessão.
      await owner`insert into public.professional_services (professional_id, service_id, specialty) values
        (${ids.pA}, ${ids.svc}, 'physiotherapy'), (${ids.pA}, ${ids.svc2}, 'physiotherapy'),
        (${ids.pA}, ${ids.svcInactive}, 'physiotherapy'), (${ids.pB}, ${ids.svc}, 'physiotherapy'),
        (${ids.pDent}, ${ids.svcDent}, 'dentistry')`;
      const pats = await owner`insert into public.patients (full_name, birth_date, deleted_at) values
        (${`${TAG} Paciente 1`}, '1990-05-10', null), (${`${TAG} Paciente 2`}, '1985-03-02', null),
        (${`${TAG} Paciente 3`}, '2001-12-31', null), (${`${TAG} Paciente Removido`}, '1999-09-09', now()),
        (${`${TAG} Paciente Outro`}, '1970-01-01', null) returning id`;
      [ids.p1, ids.p2, ids.p3, ids.pRemoved, ids.pOther] = pats.map((row) => row.id as string) as [string, string, string, string, string];
      // A Ana trabalha 08:00–12:00 e 14:00–18:00 (segunda); a Bia, o dia todo.
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
    await owner`delete from public.patients where full_name like ${like}`;
    const proIds = owner`select id from public.professionals where full_name like ${like}`;
    await owner`delete from public.professional_time_off where professional_id in (${proIds})`;
    await owner`delete from public.professional_work_hours where professional_id in (${proIds})`;
    await owner`delete from public.professional_services where professional_id in (${proIds})`;
    await owner`delete from public.professionals where full_name like ${like}`;
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
    await owner`delete from public.appointments where patient_id in (${patientIds})`;
    await owner`delete from public.professional_time_off where professional_id in (select id from public.professionals where full_name like ${`${TAG}%`})`;
  });

  type EntryInput = {
    patientId?: string;
    serviceId?: string;
    professionalId?: string | null;
    specialty?: string;
    weekdays?: number[];
    startMinute?: number | null;
    endMinute?: number | null;
    status?: "waiting" | "removed";
    createdAt?: Date;
  };
  /** Põe uma espera direto no banco (o cadastro em si é testado em `waitlist-data.test.ts`). */
  async function entry(over: EntryInput = {}): Promise<string> {
    const removed = over.status === "removed";
    const [row] = await owner`insert into public.waitlist_entries
      (patient_id, service_id, professional_id, specialty, weekdays, start_minute, end_minute, status, closed_at, closed_by, created_by, created_at)
      values (${over.patientId ?? ids.p1}, ${over.serviceId ?? ids.svc}, ${over.professionalId ?? null}, ${over.specialty ?? "physiotherapy"},
        ${over.weekdays ?? []}::smallint[], ${over.startMinute ?? null}, ${over.endMinute ?? null}, ${over.status ?? "waiting"},
        ${removed ? new Date() : null}, ${removed ? users.admin.userId : null}, ${users.admin.userId}, ${over.createdAt ?? new Date()})
      returning id`;
    return row!.id as string;
  }
  async function booking(patientId: string, professionalId: string, from: string, to: string, status = "scheduled") {
    await owner`insert into public.appointments (professional_id, patient_id, service_id, specialty, starts_at, ends_at, status, cancel_reason, created_by)
      values (${professionalId}, ${patientId}, ${ids.svc}, 'physiotherapy', ${at(from)}, ${at(to)}, ${status},
        ${status === "cancelled" ? "[teste]" : null}, ${users.admin.userId})`;
  }
  const entryIds = async (user = users.reception, slot = freed(), now = NOW) =>
    (await findCandidates(user, slot, now)).map((candidate) => candidate.entryId);

  it("quem cabe aparece com o horário do SERVIÇO (a duração vem do serviço, não do buraco)", async () => {
    const one = await entry({ patientId: ids.p1, serviceId: ids.svc });
    const two = await entry({ patientId: ids.p2, serviceId: ids.svc2 });
    const candidates = await findCandidates(users.reception, freed(), NOW);
    expect(candidates).toEqual([
      {
        entryId: one,
        patientId: ids.p1,
        patientName: `${TAG} Paciente 1`,
        serviceId: ids.svc,
        serviceName: `${TAG} Sessao`,
        startsAt: at("09:00"),
        endsAt: at("09:50"),
      },
      expect.objectContaining({ entryId: two, serviceName: `${TAG} Avaliacao`, startsAt: at("09:00"), endsAt: at("10:00") }),
    ]);
  });

  it("o admin também recebe os candidatos", async () => {
    const id = await entry();
    expect(await entryIds(users.admin)).toEqual([id]);
  });

  it("dia da semana: só quem aceita aquele dia", async () => {
    const monday = await entry({ patientId: ids.p1, weekdays: [WEEKDAY] });
    await entry({ patientId: ids.p2, weekdays: [(WEEKDAY + 1) % 7, (WEEKDAY + 3) % 7] });
    expect(await entryIds()).toEqual([monday]);
  });

  it("faixa de horário: o atendimento INTEIRO tem de caber nela", async () => {
    const inside = await entry({ patientId: ids.p1, startMinute: 540, endMinute: 600 }); // 09:00–10:00
    await entry({ patientId: ids.p2, startMinute: 840, endMinute: 1080 }); // à tarde
    await entry({ patientId: ids.p3, startMinute: 540, endMinute: 570 }); // 09:00–09:30: 50 min não cabem
    expect(await entryIds()).toEqual([inside]);
  });

  it("profissional: quem pede outro profissional não entra; quem pede este (ou qualquer) entra", async () => {
    const any = await entry({ patientId: ids.p1, professionalId: null });
    const same = await entry({ patientId: ids.p2, professionalId: ids.pA });
    await entry({ patientId: ids.p3, professionalId: ids.pB });
    expect(await entryIds()).toEqual([any, same]);
  });

  it("serviço que o profissional não oferece, serviço inativo e outra especialidade ficam de fora", async () => {
    const offered = await entry({ patientId: ids.p1, serviceId: ids.svc });
    await entry({ patientId: ids.p2, serviceId: ids.svcInactive });
    await entry({ patientId: ids.p3, serviceId: ids.svcDent, specialty: "dentistry" });
    // A Avaliação é oferecida pela Ana, mas não pela Bia: o mesmo pedido serve a uma e não à outra.
    const evaluation = await entry({ patientId: ids.pOther, serviceId: ids.svc2 });
    expect(await entryIds()).toEqual([offered, evaluation]);
    expect(await entryIds(users.reception, { ...freed(), professionalId: ids.pB })).toEqual([offered]);
  });

  it("esperas encerradas e paciente removido não entram", async () => {
    const open = await entry({ patientId: ids.p1 });
    await entry({ patientId: ids.p2, status: "removed" });
    await entry({ patientId: ids.pRemoved });
    expect(await entryIds(users.admin)).toEqual([open]);
  });

  it("conflito do PACIENTE: já tem outro atendimento naquela hora; a cancelada libera", async () => {
    const busy = ids.p1;
    await entry({ patientId: busy });
    const free = await entry({ patientId: ids.p2 });
    await booking(busy, ids.pB, "09:30", "10:20"); // com a Bia, mas sobrepõe
    await booking(ids.p2, ids.pB, "09:00", "09:50", "cancelled");
    expect(await entryIds()).toEqual([free]);
  });

  it("conflito do PROFISSIONAL: o serviço mais longo que o buraco não cabe; o curto cabe", async () => {
    const short = await entry({ patientId: ids.p1, serviceId: ids.svc }); // 50 min
    await entry({ patientId: ids.p2, serviceId: ids.svc2 }); // 60 min: bate no 09:50
    await booking(ids.pOther, ids.pA, "09:50", "10:40");
    expect(await entryIds()).toEqual([short]);
  });

  it("folga do profissional e horário fora da grade tiram todos", async () => {
    await entry({ patientId: ids.p1 });
    await owner`insert into public.professional_time_off (professional_id, starts_at, ends_at) values (${ids.pA}, ${at("09:30")}, ${at("10:00")})`;
    expect(await entryIds()).toEqual([]);
    await owner`delete from public.professional_time_off where professional_id = ${ids.pA}`;
    expect(await entryIds()).toHaveLength(1);
    // 12:30 é fora da grade (almoço da Ana).
    expect(await entryIds(users.reception, { ...freed(), startsAt: at("12:30"), endsAt: at("13:20") })).toEqual([]);
  });

  it("horário que já passou não tem candidato", async () => {
    await entry({ patientId: ids.p1 });
    expect(await entryIds(users.reception, freed(), at("09:01"))).toEqual([]);
  });

  it("o teto de 10 vale DEPOIS do filtro: esperas antigas que não cabem não ocupam vaga", async () => {
    const extra = await owner`insert into public.patients (full_name, birth_date) select ${`${TAG} Teto `} || g, '1990-01-01' from generate_series(1, 12) g returning id`;
    // Três esperas MAIS ANTIGAS que não cabem (só em outro dia), por outro serviço da mesma pessoa.
    for (const [index, patientId] of [ids.p1, ids.p2, ids.p3].entries()) {
      await entry({ patientId, serviceId: ids.svc2, weekdays: [(WEEKDAY + 1) % 7], createdAt: new Date(Date.UTC(2030, 0, 1, 0, index)) });
    }
    const created: string[] = [];
    for (const [index, row] of extra.entries()) {
      created.push(await entry({ patientId: row.id as string, createdAt: new Date(Date.UTC(2031, 0, 1, 0, index)) }));
    }
    expect(await entryIds()).toEqual(created.slice(0, 10));
  });

  it("ordem de chegada e no máximo 10", async () => {
    const extra = await owner`insert into public.patients (full_name, birth_date) select ${`${TAG} Extra `} || g, '1990-01-01' from generate_series(1, 11) g returning id`;
    const patients = [ids.p1, ids.p2, ids.p3, ...extra.map((row) => row.id as string)];
    const created: string[] = [];
    for (const [index, patientId] of patients.entries()) {
      created.push(await entry({ patientId, createdAt: new Date(Date.UTC(2031, 0, 1, 0, index)) }));
    }
    expect(created).toHaveLength(14);
    expect(await entryIds()).toEqual(created.slice(0, 10));
  });

  it("o profissional não vê nenhuma espera (não há política para ele)", async () => {
    await entry({ patientId: ids.p1 });
    expect(await entryIds(users.profA)).toEqual([]);
  });
});
