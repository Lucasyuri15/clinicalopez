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

function toDate(input: Date | string): Date {
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
