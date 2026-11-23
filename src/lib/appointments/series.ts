import { addDaysToDate, wallParts, zonedToUtc } from "@/lib/datetime";
import { checkSlot, type SlotReason, type TimeOffWindow } from "@/lib/schedule/availability";
import { weekdayOf } from "@/lib/schedule/calendar";
import type { WorkRange } from "@/lib/schedule/week";

import type { AppointmentStatus } from "./status";

/**
 * Séries e pacotes de sessões (Fase 3A). Regras PURAS: nada aqui toca o banco. Uma série é um
 * conjunto de atendimentos comuns; o conflito de horário continua sendo do banco (exclusões
 * `btree_gist`), e estas funções só calculam as datas e explicam o resultado na prévia.
 */

/** Limites decididos: 2 a 60 sessões, da primeira à última em no máximo 1 ano. */
export const SERIES_MIN_SESSIONS = 2;
export const SERIES_MAX_SESSIONS = 60;
export const SERIES_MAX_SPAN_DAYS = 365;

export type Occurrence = { date: string; startsAt: Date; endsAt: Date };

/** O banco recusa atendimento que termina em 2101 ou depois (`appointments_bounds_check`, 23514). */
const AGENDA_END_LIMIT = new Date("2101-01-01T00:00:00Z");

/**
 * As datas de uma série semanal: a partir de `firstDate` (inclusive), percorre os dias seguintes e
 * pega os que caem num dos `weekdays` (0 = domingo … 6 = sábado), até completar `count` sessões.
 *
 * - O horário é de **relógio de parede** de Brasília: cada data é calculada em dias de calendário
 *   (`addDaysToDate`) e convertida por `zonedToUtc`; NUNCA somando 7 × 24 h, que erraria quando o
 *   fuso muda.
 * - Dias da semana repetidos ou inválidos são ignorados (sem nenhum válido, não há sessões).
 * - Devolve só as sessões que cabem em `SERIES_MAX_SPAN_DAYS` a partir da primeira data: se vier
 *   menos que `count`, quem chama recusa o pedido ("passa de 1 ano").
 */
export function generateOccurrences(input: {
  firstDate: string;
  weekdays: readonly number[];
  startTime: string;
  durationMinutes: number;
  count: number;
}): Occurrence[] {
  const { firstDate, startTime, durationMinutes, count } = input;
  const days = new Set(input.weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6));
  if (days.size === 0 || count <= 0) return [];

  const result: Occurrence[] = [];
  for (let offset = 0; offset <= SERIES_MAX_SPAN_DAYS && result.length < count; offset++) {
    const date = addDaysToDate(firstDate, offset);
    if (!days.has(weekdayOf(date))) continue;
    const startsAt = zonedToUtc(date, startTime);
    result.push({ date, startsAt, endsAt: new Date(startsAt.getTime() + durationMinutes * 60_000) });
  }
  return result;
}

/** Por que uma data da série não cabe (a prévia mostra o motivo de cada uma). */
export type OccurrenceReason = "past" | SlotReason | "conflict-professional" | "conflict-patient";
export type OccurrenceVerdict = { ok: true } | { ok: false; reason: OccurrenceReason };

/** Intervalo meio-aberto `[início, fim)` de outro atendimento, já lido do banco. */
export type BusyInterval = { startsAt: Date; endsAt: Date };

const overlaps = (a: BusyInterval, b: BusyInterval): boolean => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/**
 * Decide se UMA data da série cabe. É a mesma ordem de recusas de `createAppointment` (passado →
 * grade e folga → colisão), para a prévia e a gravação dizerem a mesma coisa. Quem chama passa só
 * os atendimentos que ainda contam: sem os cancelados e, ao remarcar a série, sem as próprias
 * sessões que estão sendo movidas. A prévia é INFORMATIVA: a barreira final é a exclusão do banco.
 */
export function classifyOccurrence(input: {
  occurrence: BusyInterval;
  now: Date;
  ranges: readonly WorkRange[];
  timeOff: readonly TimeOffWindow[];
  busyProfessional: readonly BusyInterval[];
  busyPatient: readonly BusyInterval[];
}): OccurrenceVerdict {
  const { occurrence, now, ranges, timeOff, busyProfessional, busyPatient } = input;
  if (occurrence.startsAt < now) return { ok: false, reason: "past" };
  if (occurrence.endsAt >= AGENDA_END_LIMIT) return { ok: false, reason: "invalid" };

  const slot = checkSlot({ startsAt: occurrence.startsAt, endsAt: occurrence.endsAt, ranges, timeOff });
  if (!slot.ok) return { ok: false, reason: slot.reason };

  if (busyProfessional.some((other) => overlaps(occurrence, other))) {
    return { ok: false, reason: "conflict-professional" };
  }
  if (busyPatient.some((other) => overlaps(occurrence, other))) return { ok: false, reason: "conflict-patient" };
  return { ok: true };
}

/** Uma sessão da série, como a remarcação e o progresso a enxergam. */
export type SeriesMember = { id: string; startsAt: Date; endsAt: Date; status: AppointmentStatus };

export type SeriesMove = {
  id: string;
  from: { startsAt: Date; endsAt: Date };
  to: { startsAt: Date; endsAt: Date };
};

/** Só as sessões em aberto podem ser remarcadas (o gatilho do banco exige o mesmo). */
const isOpen = (status: AppointmentStatus): boolean => status === "scheduled" || status === "confirmed";

/** Diferença em dias de calendário entre duas datas `AAAA-MM-DD` (sem depender de fuso). */
function daysBetween(from: string, to: string): number {
  const [fy = 0, fm = 1, fd = 1] = from.split("-").map(Number);
  const [ty = 0, tm = 1, td = 1] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * "Remarcar daqui para frente": leva a sessão `fromId` para `newDate`/`newTime` e desloca TODAS as
 * seguintes que ainda estão abertas pelo MESMO número de dias de calendário (o padrão da série,
 * como terça/quinta, anda junto), com o novo horário e a nova duração. Não mexe nas anteriores nem
 * nas fechadas (realizada, falta, cancelada).
 *
 * A ORDEM do resultado é a de aplicação e importa: ao andar para a frente, a última sessão sai
 * primeiro (assim cada uma cai num horário que a seguinte já liberou); ao andar para trás, a
 * primeira sai primeiro. Sem isso, deslocar terça para quinta bateria na própria quinta da série.
 * Sessões que já estão exatamente no destino não geram movimento. `now` não filtra nada aqui: o
 * horário novo no passado é recusado por `classifyOccurrence` (`past`).
 */
export function shiftSeriesFrom(input: {
  members: readonly SeriesMember[];
  fromId: string;
  newDate: string;
  newTime: string;
  newDurationMinutes: number;
  now: Date;
}): SeriesMove[] {
  const { members, fromId, newDate, newTime, newDurationMinutes } = input;
  const anchor = members.find((member) => member.id === fromId);
  if (!anchor || !isOpen(anchor.status)) return [];

  const delta = daysBetween(wallParts(anchor.startsAt).date, newDate);
  const targets = members
    .filter((member) => isOpen(member.status) && member.startsAt >= anchor.startsAt)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const moves: SeriesMove[] = [];
  for (const member of targets) {
    const startsAt = zonedToUtc(addDaysToDate(wallParts(member.startsAt).date, delta), newTime);
    const endsAt = new Date(startsAt.getTime() + newDurationMinutes * 60_000);
    if (startsAt.getTime() === member.startsAt.getTime() && endsAt.getTime() === member.endsAt.getTime()) continue;
    moves.push({
      id: member.id,
      from: { startsAt: member.startsAt, endsAt: member.endsAt },
      to: { startsAt, endsAt },
    });
  }
  return delta > 0 ? moves.reverse() : moves;
}

export type SeriesProgress = {
  /** Posição desta sessão entre as não canceladas, a partir de 1 (nula se ela mesma foi cancelada). */
  position: number | null;
  /** Sessões não canceladas. */
  total: number;
  done: number;
  noShow: number;
  /** Ainda em aberto (agendada ou confirmada). */
  remaining: number;
  cancelled: number;
};

/** Acompanhamento da série (realizadas × restantes), calculado a partir do status de cada sessão. */
export function seriesProgress(members: readonly SeriesMember[], currentId: string): SeriesProgress {
  const live = members.filter((member) => member.status !== "cancelled").sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const index = live.findIndex((member) => member.id === currentId);
  return {
    position: index === -1 ? null : index + 1,
    total: live.length,
    done: live.filter((member) => member.status === "done").length,
    noShow: live.filter((member) => member.status === "no_show").length,
    remaining: live.filter((member) => isOpen(member.status)).length,
    cancelled: members.length - live.length,
  };
}
