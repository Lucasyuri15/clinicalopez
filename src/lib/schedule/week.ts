import { DAY_MINUTES, formatTime, STEP_MINUTES, WEEKDAY_ORDER, weekdayLabel } from "./time";

/** Uma faixa de atendimento: `weekday` 0 (domingo) a 6; `start`/`end` em minutos, `[start, end)`. */
export type WorkRange = { weekday: number; start: number; end: number };

export const MAX_RANGES_PER_DAY = 6;

export type WeekValidation = { ok: true; ranges: WorkRange[] } | { ok: false; error: string };

const fail = (error: string): WeekValidation => ({ ok: false, error });
const span = (range: WorkRange) => `${formatTime(range.start)}–${formatTime(range.end)}`;

/**
 * Valida a semana inteira e devolve as faixas ORDENADAS (dia, início). Regras: dia de 0 a 6;
 * horários inteiros, de 5 em 5 minutos, entre 00:00 e 24:00; fim depois do início; sem
 * sobreposição no mesmo dia (faixas que apenas encostam valem); no máximo 6 faixas por dia.
 * Mensagens em pt-BR, com o nome do dia. Não altera a lista recebida.
 */
export function validateWeek(input: readonly WorkRange[]): WeekValidation {
  for (const range of input) {
    if (!Number.isInteger(range.weekday) || range.weekday < 0 || range.weekday > 6) {
      return fail("Dia da semana inválido.");
    }
    const day = weekdayLabel(range.weekday);
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
      return fail(`${day}: os horários devem ser de ${STEP_MINUTES} em ${STEP_MINUTES} minutos.`);
    }
    if (range.start < 0 || range.end > DAY_MINUTES) {
      return fail(`${day}: os horários devem ficar entre 00:00 e 24:00.`);
    }
    if (range.start % STEP_MINUTES !== 0 || range.end % STEP_MINUTES !== 0) {
      return fail(`${day}: os horários devem ser de ${STEP_MINUTES} em ${STEP_MINUTES} minutos.`);
    }
    if (range.end <= range.start) return fail(`${day}: o fim deve ser depois do início.`);
  }

  const sorted = [...input].sort((a, b) => a.weekday - b.weekday || a.start - b.start || a.end - b.end);
  let count = 0;
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i] as WorkRange;
    const previous = sorted[i - 1];
    if (previous && previous.weekday === current.weekday) {
      count += 1;
      if (current.start < previous.end) {
        return fail(`${weekdayLabel(current.weekday)}: as faixas ${span(previous)} e ${span(current)} se sobrepõem.`);
      }
    } else {
      count = 1;
    }
    if (count > MAX_RANGES_PER_DAY) {
      return fail(`${weekdayLabel(current.weekday)}: no máximo ${MAX_RANGES_PER_DAY} faixas por dia.`);
    }
  }
  return { ok: true, ranges: sorted };
}

export type DaySummary = { weekday: number; label: string; text: string };

/** Resumo para a tela de leitura: um item por dia (segunda a domingo), ex.: "08:00–12:00 · 14:00–18:00". */
export function summarizeWeek(ranges: readonly WorkRange[]): DaySummary[] {
  return WEEKDAY_ORDER.map((weekday) => {
    const day = ranges.filter((range) => range.weekday === weekday).sort((a, b) => a.start - b.start);
    return {
      weekday,
      label: weekdayLabel(weekday),
      text: day.length > 0 ? day.map(span).join(" · ") : "Sem atendimento",
    };
  });
}
