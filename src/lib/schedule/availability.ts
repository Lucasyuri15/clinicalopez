import { addDaysToDate, wallParts } from "@/lib/datetime";

import { DAY_MINUTES, STEP_MINUTES } from "./time";
import type { WorkRange } from "./week";

/**
 * Disponibilidade de um horário (Fase 2, agenda): o contrato da grade de horários é
 * "disponibilidade = grade semanal − folgas e bloqueios". Esta função é PURA: recebe as faixas da
 * semana e as folgas já lidas e decide se UM horário cabe. Quem agenda ainda depende do banco para
 * o conflito com outros atendimentos (restrição de exclusão); aqui só vale a grade e as folgas.
 *
 * - A grade é de "relógio de parede" (minutos desde a meia-noite, em Brasília); o horário chega como
 *   instante UTC e é convertido por `wallParts` com o fuso de verdade, nunca com -3 h fixo (o Brasil
 *   já teve horário de verão e pode voltar a ter).
 * - O horário tem de ser de 5 em 5 minutos e sem segundos, no mesmo dia local (terminar à
 *   meia-noite do dia seguinte vale, como 24:00).
 * - Cabe se uma ÚNICA faixa do dia da semana o contém: faixas que só se encostam (08–12 e 12–14)
 *   valem como uma; um vão (almoço) não.
 * - Folga e atendimento são meio-abertos `[início, fim)`: terminar quando a folga começa vale.
 * Ordem das razões: invalid → crosses-midnight → outside-grid → time-off.
 */
export type SlotReason = "invalid" | "crosses-midnight" | "outside-grid" | "time-off";
export type SlotResult = { ok: true } | { ok: false; reason: SlotReason };
export type TimeOffWindow = { startsAt: Date; endsAt: Date };

const reject = (reason: SlotReason): SlotResult => ({ ok: false, reason });

export function checkSlot(input: {
  startsAt: Date;
  endsAt: Date;
  ranges: readonly WorkRange[];
  timeOff: readonly TimeOffWindow[];
}): SlotResult {
  const { startsAt, endsAt, ranges, timeOff } = input;
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || startsAt >= endsAt) {
    return reject("invalid");
  }

  // `wallParts` descarta os milissegundos; o banco, não: instantes redondos, ao segundo.
  if (startsAt.getTime() % 1000 !== 0 || endsAt.getTime() % 1000 !== 0) return reject("invalid");

  const start = wallParts(startsAt);
  const end = wallParts(endsAt);
  if (start.second !== 0 || end.second !== 0 || start.minute % STEP_MINUTES !== 0 || end.minute % STEP_MINUTES !== 0) {
    return reject("invalid");
  }

  let endMinute: number;
  if (end.date === start.date) {
    endMinute = end.minute;
  } else if (end.minute === 0 && end.date === addDaysToDate(start.date, 1)) {
    endMinute = DAY_MINUTES;
  } else {
    return reject("crosses-midnight");
  }
  // Mesmo dia local, mas o relógio não andou para a frente (hora repetida no fim do horário de verão).
  if (endMinute <= start.minute) return reject("invalid");

  // Faixas do dia da semana, em ordem, juntando as que só se encostam.
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of [...ranges].filter((r) => r.weekday === start.weekday).sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ start: range.start, end: range.end });
  }
  if (!merged.some((range) => range.start <= start.minute && range.end >= endMinute)) {
    return reject("outside-grid");
  }

  if (timeOff.some((off) => off.startsAt < endsAt && startsAt < off.endsAt)) return reject("time-off");
  return { ok: true };
}
