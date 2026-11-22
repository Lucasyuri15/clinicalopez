const TIME_ZONE = "America/Sao_Paulo";

const dateFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const timeFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// Texto precisa trazer data, hora e fuso (Z ou ±hh:mm). Sem fuso, o resultado
// dependeria da máquina que executa; só data ("2026-11-04") viraria UTC e,
// em Brasília, um dia a menos.
const ISO_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

function toDate(input: Date | string): Date {
  if (typeof input === "string" && !ISO_WITH_OFFSET.test(input)) {
    throw new RangeError(
      "Data como texto deve ser ISO 8601 com fuso (ex.: 2026-11-04T17:30:00Z).",
    );
  }
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("Data inválida.");
  }
  return date;
}

/** Datas são guardadas em UTC; estas funções só formatam para exibição em Brasília. */
export function formatDateBR(input: Date | string): string {
  return dateFormat.format(toDate(input));
}

export function formatTimeBR(input: Date | string): string {
  return timeFormat.format(toDate(input));
}

export function formatDateTimeBR(input: Date | string): string {
  const date = toDate(input);
  return `${dateFormat.format(date)} ${timeFormat.format(date)}`;
}

// ---------------------------------------------------------------------------------------------
// Horário de parede de Brasília <-> UTC (usado nas folgas e bloqueios da grade de horários).
// ---------------------------------------------------------------------------------------------
const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME_TEXT = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A data de hoje em Brasília, "AAAA-MM-DD" (não a do relógio UTC do servidor). */
export function todayBR(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Data de calendário "AAAA-MM-DD" que existe de verdade (rejeita 30/02, mês 13 etc.). */
export function isRealDate(text: string): boolean {
  const match = DATE_TEXT.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Soma dias a uma data de calendário "AAAA-MM-DD" (sem fuso: é só aritmética de calendário). */
export function addDaysToDate(text: string, days: number): string {
  if (!isRealDate(text)) throw new RangeError("Data inválida (esperado AAAA-MM-DD).");
  const [year, month, day] = text.split("-").map(Number) as [number, number, number];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day + days);
  if (date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999) {
    throw new RangeError("A data resultante sai do intervalo de anos de 0000 a 9999.");
  }
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

const wallClockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** O relógio de parede de Brasília em `utcMs`, escrito como se fosse UTC (para comparar e subtrair). */
function wallClockMs(utcMs: number): number {
  const part = (type: string) =>
    Number(wallClockFormat.formatToParts(new Date(utcMs)).find((p) => p.type === type)?.value);
  // `setUTCFullYear` (e não `Date.UTC`, que trata anos de 0 a 99 como 1900 a 1999).
  const wall = new Date(0);
  wall.setUTCFullYear(part("year"), part("month") - 1, part("day"));
  wall.setUTCHours(part("hour"), part("minute"), part("second"), 0);
  return wall.getTime();
}

/**
 * O relógio de parede de Brasília em um instante: data local "AAAA-MM-DD", minuto do dia (0 a 1439),
 * segundo e dia da semana (0 = domingo a 6 = sábado), igual à convenção da grade de horários.
 * Usa o fuso de verdade (`Intl`), nunca um deslocamento fixo. Numa hora que existiu duas vezes
 * (fim do horário de verão) as duas ocorrências mostram o mesmo relógio.
 */
export function wallParts(instant: Date): { date: string; minute: number; second: number; weekday: number } {
  if (Number.isNaN(instant.getTime())) throw new RangeError("Instante inválido.");
  const wall = new Date(wallClockMs(instant.getTime()));
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return {
    date: `${pad(wall.getUTCFullYear(), 4)}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`,
    minute: wall.getUTCHours() * 60 + wall.getUTCMinutes(),
    second: wall.getUTCSeconds(),
    weekday: wall.getUTCDay(),
  };
}

/**
 * Converte data e hora DIGITADAS em Brasília ("2026-12-24", "08:00") para o instante em UTC.
 * Usa o fuso de verdade (`Intl`), não um deslocamento fixo: o Brasil já teve horário de verão
 * (até fev/2019) e pode voltar a ter. Nos casos raros de transição: uma hora que NÃO existiu
 * resolve para a frente; uma hora que existiu DUAS vezes resolve para a primeira.
 * `time` é "HH:MM" de 00:00 a 23:59 (para o fim do dia use 00:00 do dia seguinte).
 */
export function zonedToUtc(date: string, time: string): Date {
  const timeMatch = WALL_TIME_TEXT.exec(time);
  if (!isRealDate(date) || !timeMatch) {
    throw new RangeError("Data (AAAA-MM-DD) ou hora (HH:MM) inválida.");
  }
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  wall.setUTCHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
  const wallMs = wall.getTime();

  const first = wallMs - (wallClockMs(wallMs) - wallMs);
  const second = wallMs - (wallClockMs(first) - first);
  const candidates = [...new Set([first, second])].sort((a, b) => a - b);
  const exact = candidates.find((candidate) => wallClockMs(candidate) === wallMs);
  return new Date(exact ?? candidates[candidates.length - 1] ?? first);
}
