import { formatDateBR, zonedToUtc } from "@/lib/datetime";
import { mondayOf, weekDates, weekdayOf } from "@/lib/schedule/calendar";
import { weekdayLabel } from "@/lib/schedule/time";

/** "AAAA-MM-DD" → "23/11/2026" (meio-dia de Brasília: nunca cai no dia vizinho por fuso). */
const full = (date: string) => formatDateBR(zonedToUtc(date, "12:00"));

/** "Segunda-feira, 23/11/2026". */
export function dayHeading(date: string): string {
  return `${weekdayLabel(weekdayOf(date))}, ${full(date)}`;
}

/** "23/11/2026 a 29/11/2026": a semana de segunda a domingo que contém `date`. */
export function weekHeading(date: string): string {
  const days = weekDates(mondayOf(date));
  return `${full(days[0] as string)} a ${full(days[6] as string)}`;
}

/** "23/11". */
export function shortDate(date: string): string {
  return full(date).slice(0, 5);
}
