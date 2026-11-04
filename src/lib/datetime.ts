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
