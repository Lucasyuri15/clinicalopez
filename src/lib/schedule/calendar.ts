import { addDaysToDate, isRealDate, zonedToUtc } from "@/lib/datetime";

/**
 * Aritmética de calendário da agenda (Fase 2), toda PURA. Datas são "AAAA-MM-DD" de Brasília; a
 * semana vai de SEGUNDA a domingo. As janelas em UTC usam o fuso de verdade (`zonedToUtc`), não um
 * deslocamento fixo: um dia pode ter 23 h ou 25 h na virada do horário de verão (o Brasil já teve).
 */
export type AgendaView = "day" | "week";

/** Dia da semana de uma data de calendário: 0 = domingo a 6 = sábado (como a grade de horários). */
export function weekdayOf(date: string): number {
  if (!isRealDate(date)) throw new RangeError("Data inválida (esperado AAAA-MM-DD).");
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day);
  return utc.getUTCDay();
}

/** A segunda-feira da semana que contém `date` (o domingo pertence à semana que começou antes). */
export function mondayOf(date: string): string {
  return addDaysToDate(date, -((weekdayOf(date) + 6) % 7));
}

/** As 7 datas da semana de `date`, de segunda a domingo. */
export function weekDates(date: string): string[] {
  const monday = mondayOf(date);
  return Array.from({ length: 7 }, (_, index) => addDaysToDate(monday, index));
}

export type UtcWindow = { from: Date; to: Date };

/** O dia inteiro de Brasília como janela UTC meio-aberta `[from, to)`. */
export function dayWindow(date: string): UtcWindow {
  return { from: zonedToUtc(date, "00:00"), to: zonedToUtc(addDaysToDate(date, 1), "00:00") };
}

/** A semana (segunda a domingo) que contém `date`, como janela UTC meio-aberta. */
export function weekWindow(date: string): UtcWindow {
  const monday = mondayOf(date);
  return { from: zonedToUtc(monday, "00:00"), to: zonedToUtc(addDaysToDate(monday, 7), "00:00") };
}

/** Anterior (-1) ou próximo (1) na visão atual: 1 dia na visão de dia, 7 na de semana. */
export function stepDate(date: string, view: AgendaView, direction: 1 | -1): string {
  return addDaysToDate(date, direction * (view === "week" ? 7 : 1));
}
