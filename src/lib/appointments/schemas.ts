import { z } from "zod";

import { SPECIALTIES, type Specialty } from "@/lib/catalog/labels";
import { isRealDate, zonedToUtc } from "@/lib/datetime";
import { STEP_MINUTES } from "@/lib/schedule/time";
import type { AgendaView } from "@/lib/schedule/calendar";

import { generateOccurrences, SERIES_MAX_SESSIONS, SERIES_MIN_SESSIONS, type Occurrence } from "./series";

/**
 * Validação (Zod) das entradas da agenda. Recebe o que vem do formulário (tudo texto) e devolve
 * tipos prontos (instantes UTC). Os limites espelham os `CHECK` do banco; aqui a mensagem é em
 * pt-BR e o banco é a última barreira. A regra da GRADE e das FOLGAS não está aqui: é de
 * `checkSlot` (precisa das faixas do profissional); aqui só se valida a forma do pedido.
 *
 * DADO SENSÍVEL: nenhuma mensagem de erro repete o que foi digitado. O motivo do cancelamento é
 * texto livre: avise para não registrar dado de saúde e nunca o coloque em log ou URL.
 */
export const CANCEL_REASON_MAX = 200;
export const MIN_DURATION = 5;
export const MAX_DURATION = 480;
/** Intervalo de datas aceito na agenda (o mesmo dos limites do banco). */
export const AGENDA_DATE_MIN = "2000-01-01";
export const AGENDA_DATE_MAX = "2100-12-31";

const length = (text: string) => [...text].length;
const TIME_TEXT = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** Caracteres de controle (byte nulo, bell...) não são texto: o banco recusaria (22021). */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

type Fail = (field: string, message: string) => void;

const uuidOf = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  return z.guid().safeParse(value).success ? value : null;
};

/** Valida data, horário de início e duração; devolve o intervalo UTC ou `null` (e registra os erros). */
function parseSlot(
  v: { date: string; startTime: string; durationMinutes: string },
  now: Date,
  fail: Fail,
): { startsAt: Date; endsAt: Date } | null {
  const date = v.date.trim();
  let valid = true;
  if (date === "") {
    fail("date", "Informe a data.");
    valid = false;
  } else if (!isRealDate(date) || date < AGENDA_DATE_MIN || date > AGENDA_DATE_MAX) {
    fail("date", "Data inválida.");
    valid = false;
  }

  const time = v.startTime.trim();
  const match = TIME_TEXT.exec(time);
  if (!match) {
    fail("startTime", "Informe o horário de início (HH:MM).");
    valid = false;
  } else if (Number(match[2]) % STEP_MINUTES !== 0) {
    fail("startTime", `O horário deve ser de ${STEP_MINUTES} em ${STEP_MINUTES} minutos.`);
    valid = false;
  }

  const durationText = v.durationMinutes.trim();
  const duration = /^\d+$/.test(durationText) ? Number(durationText) : Number.NaN;
  if (
    !Number.isInteger(duration) ||
    duration < MIN_DURATION ||
    duration > MAX_DURATION ||
    duration % STEP_MINUTES !== 0
  ) {
    fail("durationMinutes", `Informe a duração em minutos (de ${MIN_DURATION} a ${MAX_DURATION}, de ${STEP_MINUTES} em ${STEP_MINUTES}).`);
    valid = false;
  }
  if (!valid) return null;

  const startsAt = zonedToUtc(date, time);
  if (startsAt.getTime() < now.getTime()) {
    fail("startTime", "Esse horário já passou.");
    return null;
  }
  return { startsAt, endsAt: new Date(startsAt.getTime() + duration * 60_000) };
}

/** Agendar: paciente, profissional, serviço e o horário. `now` injetado para o teste não depender do relógio. */
export function createAppointmentSchema(now: Date) {
  return z
    .object({
      patientId: z.string(),
      professionalId: z.string(),
      serviceId: z.string(),
      date: z.string(),
      startTime: z.string(),
      durationMinutes: z.string(),
    })
    .transform((v, ctx) => {
      let failed = false;
      const fail: Fail = (field, message) => {
        failed = true;
        ctx.addIssue({ code: "custom", path: [field], message });
      };
      const patientId = uuidOf(v.patientId);
      if (patientId === null) fail("patientId", "Paciente inválido.");
      const professionalId = uuidOf(v.professionalId);
      if (professionalId === null) fail("professionalId", "Profissional inválido.");
      const serviceId = uuidOf(v.serviceId);
      if (serviceId === null) fail("serviceId", "Serviço inválido.");
      const slot = parseSlot(v, now, fail);

      if (failed || !slot || !patientId || !professionalId || !serviceId) return z.NEVER;
      return { patientId, professionalId, serviceId, startsAt: slot.startsAt, endsAt: slot.endsAt };
    });
}

/** Remarcar: só o horário muda (o profissional e o serviço ficam; para trocar, cancele e crie outro). */
export function rescheduleAppointmentSchema(now: Date) {
  return z
    .object({ id: z.string(), date: z.string(), startTime: z.string(), durationMinutes: z.string() })
    .transform((v, ctx) => {
      let failed = false;
      const fail: Fail = (field, message) => {
        failed = true;
        ctx.addIssue({ code: "custom", path: [field], message });
      };
      const id = uuidOf(v.id);
      if (id === null) fail("id", "Atendimento inválido.");
      const slot = parseSlot(v, now, fail);
      if (failed || !slot || !id) return z.NEVER;
      return { id, startsAt: slot.startsAt, endsAt: slot.endsAt };
    });
}

/** Cancelar: o motivo é obrigatório (texto livre, limpo e sem repetir espaços). */
export const cancelAppointmentSchema = z
  .object({ id: z.string(), reason: z.string() })
  .transform((v, ctx) => {
    let failed = false;
    const fail: Fail = (field, message) => {
      failed = true;
      ctx.addIssue({ code: "custom", path: [field], message });
    };
    const id = uuidOf(v.id);
    if (id === null) fail("id", "Atendimento inválido.");

    let reason = "";
    if (CONTROL.test(v.reason.replace(/\s/g, " "))) {
      fail("reason", "O motivo contém caracteres inválidos.");
    } else {
      reason = v.reason.normalize("NFC").trim().replace(/\s+/g, " ");
      if (reason === "") fail("reason", "Informe o motivo do cancelamento.");
      else if (length(reason) > CANCEL_REASON_MAX) {
        fail("reason", `O motivo pode ter até ${CANCEL_REASON_MAX} caracteres.`);
      }
    }
    if (failed || !id) return z.NEVER;
    return { id, reason };
  });

/**
 * Padrão de uma série semanal (criar e renovar): data de partida, horário, duração, dias da semana
 * e número de sessões. NÃO recusa partida no passado: a prévia classifica cada sessão (`past`) e a
 * gravação recusa as que já passaram. Devolve também as datas já calculadas (`generateOccurrences`),
 * e recusa a série que não cabe em 1 ano. Mensagens fixas: nunca repetem o que foi digitado.
 */
type PatternInput = {
  date: string;
  startTime: string;
  durationMinutes: string;
  weekdays: string[];
  count: string;
};

type Pattern = {
  firstDate: string;
  startTime: string;
  durationMinutes: number;
  weekdays: number[];
  count: number;
  occurrences: Occurrence[];
};

function parsePattern(v: PatternInput, fail: Fail): Pattern | null {
  const slot = parseSlot(v, new Date(0), fail);

  let weekdays: number[] | null = null;
  if (v.weekdays.length === 0) {
    fail("weekdays", "Escolha ao menos um dia da semana.");
  } else if (!v.weekdays.every((day) => /^[0-6]$/.test(day.trim()))) {
    fail("weekdays", "Dia da semana inválido.");
  } else {
    weekdays = [...new Set(v.weekdays.map((day) => Number(day.trim())))].sort((a, b) => a - b);
  }

  const countText = v.count.trim();
  const count = /^\d+$/.test(countText) ? Number(countText) : Number.NaN;
  const countOk = Number.isInteger(count) && count >= SERIES_MIN_SESSIONS && count <= SERIES_MAX_SESSIONS;
  if (!countOk) fail("count", `Informe de ${SERIES_MIN_SESSIONS} a ${SERIES_MAX_SESSIONS} sessões.`);

  if (!slot || !weekdays || !countOk) return null;
  const firstDate = v.date.trim();
  const startTime = v.startTime.trim();
  const durationMinutes = Math.round((slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000);
  const occurrences = generateOccurrences({ firstDate, weekdays, startTime, durationMinutes, count });
  if (occurrences.length < count) {
    fail("count", "A série passa de 1 ano. Reduza o número de sessões.");
    return null;
  }
  if ((occurrences.at(-1)?.date ?? "") > AGENDA_DATE_MAX) {
    fail("count", "A série passa da data máxima da agenda (31/12/2100).");
    return null;
  }
  return { firstDate, startTime, durationMinutes, weekdays, count, occurrences };
}

const PATTERN_FIELDS = {
  date: z.string(),
  startTime: z.string(),
  durationMinutes: z.string(),
  weekdays: z.array(z.string()),
  count: z.string(),
};

/** Criar série (e a prévia dela): paciente, profissional, serviço e o padrão semanal. */
export function createSeriesSchema() {
  return z
    .object({ patientId: z.string(), professionalId: z.string(), serviceId: z.string(), ...PATTERN_FIELDS })
    .transform((v, ctx) => {
      let failed = false;
      const fail: Fail = (field, message) => {
        failed = true;
        ctx.addIssue({ code: "custom", path: [field], message });
      };
      const patientId = uuidOf(v.patientId);
      if (patientId === null) fail("patientId", "Paciente inválido.");
      const professionalId = uuidOf(v.professionalId);
      if (professionalId === null) fail("professionalId", "Profissional inválido.");
      const serviceId = uuidOf(v.serviceId);
      if (serviceId === null) fail("serviceId", "Serviço inválido.");
      const pattern = parsePattern(v, fail);
      if (failed || !pattern || !patientId || !professionalId || !serviceId) return z.NEVER;
      return { patientId, professionalId, serviceId, ...pattern };
    });
}

/** Renovar série: o mesmo padrão sobre uma série que já existe (profissional, paciente e serviço vêm dela). */
export function renewSeriesSchema() {
  return z.object({ seriesId: z.string(), ...PATTERN_FIELDS }).transform((v, ctx) => {
    let failed = false;
    const fail: Fail = (field, message) => {
      failed = true;
      ctx.addIssue({ code: "custom", path: [field], message });
    };
    const seriesId = uuidOf(v.seriesId);
    if (seriesId === null) fail("seriesId", "Série inválida.");
    const pattern = parsePattern(v, fail);
    if (failed || !pattern || !seriesId) return z.NEVER;
    return { seriesId, ...pattern };
  });
}

/** Mudar o status (sem cancelar: cancelar tem ação própria, com motivo). */
export const CHANGEABLE_STATUSES = ["confirmed", "done", "no_show"] as const;
export type ChangeableStatus = (typeof CHANGEABLE_STATUSES)[number];

export const statusChangeSchema = z
  .object({ id: z.string(), status: z.unknown() })
  .transform((v, ctx) => {
    let failed = false;
    const fail: Fail = (field, message) => {
      failed = true;
      ctx.addIssue({ code: "custom", path: [field], message });
    };
    const id = uuidOf(v.id);
    if (id === null) fail("id", "Atendimento inválido.");
    const status = typeof v.status === "string" ? v.status.trim() : "";
    if (!(CHANGEABLE_STATUSES as readonly string[]).includes(status)) fail("status", "Status inválido.");
    if (failed || !id) return z.NEVER;
    return { id, status: status as ChangeableStatus };
  });

export type AgendaFilters = {
  view: AgendaView;
  date: string;
  professional: string | null;
  specialty: Specialty | null;
};

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

/**
 * Filtros da URL da agenda (`?view=week&date=...&professional=...&specialty=...`). NUNCA quebra a
 * tela: qualquer valor inválido volta ao padrão (visão de dia, hoje, sem filtro). Parâmetro repetido
 * vale o primeiro. Nenhum dado de paciente vai na URL.
 */
export function parseAgendaFilters(
  params: Record<string, string | string[] | undefined>,
  today: string,
): AgendaFilters {
  const view: AgendaView = first(params.view) === "week" ? "week" : "day";
  const rawDate = first(params.date).trim();
  const date = isRealDate(rawDate) && rawDate >= AGENDA_DATE_MIN && rawDate <= AGENDA_DATE_MAX ? rawDate : today;
  const professional = uuidOf(first(params.professional));
  const rawSpecialty = first(params.specialty).trim();
  const specialty = (SPECIALTIES as readonly string[]).includes(rawSpecialty) ? (rawSpecialty as Specialty) : null;
  return { view, date, professional, specialty };
}
