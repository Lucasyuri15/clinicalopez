/**
 * Horários da grade em MINUTOS desde a meia-noite (0 a 1440). Faixas são meio-abertas
 * `[início, fim)`: o fim de uma faixa pode ser o início de outra sem conflito.
 */
export const STEP_MINUTES = 5;
export const DAY_MINUTES = 1440;

const TIME_TEXT = /^(?:([01]\d|2[0-3]):([0-5]\d)|(24):00)$/;

/**
 * "08:30" → 510. Aceita 00:00 a 23:59 e "24:00" (fim do dia, só faz sentido como término).
 * Não impõe o passo de 5 minutos: isso é da validação da semana. `null` se o texto não for HH:MM.
 */
export function parseTime(text: string): number | null {
  const match = TIME_TEXT.exec(text);
  if (!match) return null;
  if (match[3]) return DAY_MINUTES;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 510 → "08:30"; 1440 → "24:00". */
export function formatTime(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > DAY_MINUTES) {
    throw new RangeError("Minutos do dia devem ser um inteiro de 0 a 1440.");
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** 0 = domingo, como `Date.getDay()` e o `dow` do Postgres. */
const WEEKDAYS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

/** Ordem de exibição: a semana da clínica vai de segunda a domingo. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export function weekdayLabel(weekday: number): string {
  const label = Number.isInteger(weekday) ? WEEKDAYS[weekday] : undefined;
  if (!label) throw new RangeError("Dia da semana deve ser um inteiro de 0 a 6.");
  return label;
}
