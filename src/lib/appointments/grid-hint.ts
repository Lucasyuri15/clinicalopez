import { summarizeWeek, type WorkRange } from "@/lib/schedule/week";

export type GridDay = { label: string; text: string };

/**
 * Os dias em que o profissional atende (segunda a domingo) e as faixas de cada um, para a dica
 * na hora de agendar ("Segunda-feira: 08:00–12:00 · 14:00–18:00"). Sem grade: lista vazia.
 * É só uma DICA: quem recusa o horário fora da grade é o servidor (`checkSlot`).
 */
export function gridDays(ranges: readonly WorkRange[]): GridDay[] {
  const days = new Set(ranges.map((range) => range.weekday));
  return summarizeWeek(ranges)
    .filter((day) => days.has(day.weekday))
    .map(({ label, text }) => ({ label, text }));
}
