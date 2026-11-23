/**
 * Datas e horários dos e2e da agenda, em horário de Brasília. O Brasil não tem horário de verão
 * desde 2019, então o deslocamento fixo de -03:00 vale para as datas usadas aqui (de agora em
 * diante): é só para MONTAR os dados do teste; a regra do app usa o fuso de verdade.
 */
const BRT = "America/Sao_Paulo";

const dateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: BRT, year: "numeric", month: "2-digit", day: "2-digit" });

/** "AAAA-MM-DD" de Brasília para um instante. */
export const brtDate = (instant: Date): string => dateFormat.format(instant);

/** O instante de uma data e hora ("AAAA-MM-DD", "HH:MM") de Brasília. */
export const brtInstant = (date: string, time: string): Date => new Date(`${date}T${time}:00-03:00`);

const addDays = (date: string, days: number): string =>
  new Date(new Date(`${date}T12:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

const weekday = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();

/**
 * A primeira SEGUNDA-FEIRA a partir de amanhã (o profissional `own` atende segunda 08–12 e 14–18)
 * que não é um dos dias de folga criados por `seedSchedule` (hoje + 10 e + 20).
 */
export function nextMonday(from: Date = new Date()): string {
  const today = brtDate(from);
  const off = new Set([addDays(today, 10), addDays(today, 20)]);
  for (let step = 1; step <= 60; step += 1) {
    const date = addDays(today, step);
    if (weekday(date) === 1 && !off.has(date)) return date;
  }
  throw new Error("Nenhuma segunda-feira livre encontrada.");
}

/** Um início passado (agora − 2 h, em múltiplo de 5 min): para marcar Realizada ou Falta. */
export function pastStart(from: Date = new Date()): Date {
  const step = 5 * 60_000;
  return new Date(Math.floor((from.getTime() - 2 * 3_600_000) / step) * step);
}

/** Escapa um texto para usá-lo dentro de `new RegExp(...)` (as etiquetas dos e2e têm colchetes). */
export const esc = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `count` segundas-feiras CONSECUTIVAS a partir de amanhã, nenhuma delas um dia de folga criado por
 * `seedSchedule` (hoje + 10 e + 20): para as séries semanais não esbarrarem numa folga sem querer.
 */
export function freeMondays(count: number, from: Date = new Date()): string[] {
  const today = brtDate(from);
  const off = new Set([addDays(today, 10), addDays(today, 20)]);
  for (let step = 1; step <= 120; step += 1) {
    const first = addDays(today, step);
    if (weekday(first) !== 1) continue;
    const dates = Array.from({ length: count }, (_, index) => addDays(first, index * 7));
    if (dates.every((date) => !off.has(date))) return dates;
  }
  throw new Error("Nenhuma sequência de segundas-feiras livres encontrada.");
}
