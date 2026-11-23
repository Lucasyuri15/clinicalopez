import { wallParts } from "@/lib/datetime";
import { DAY_MINUTES, formatTime, WEEKDAY_ORDER } from "@/lib/schedule/time";

import { WEEKDAY_SHORT } from "./labels";

/**
 * A preferência de uma espera. `weekdays` vazio = qualquer dia (0 = domingo a 6); `startMinute` e
 * `endMinute` nulos = qualquer horário (minutos desde a meia-noite de Brasília, o fim pode ser 1440).
 */
export type Preference = {
  weekdays: readonly number[];
  startMinute: number | null;
  endMinute: number | null;
};

/**
 * A preferência aceita este atendimento? O dia da semana e a faixa valem no relógio de Brasília, e a
 * faixa exige o atendimento INTEIRO dentro dela (o fim pode coincidir com o fim da faixa). Só a
 * preferência: grade, folga e conflito são de `classifyOccurrence`.
 */
export function matchesPreference(preference: Preference, occurrence: { startsAt: Date; endsAt: Date }): boolean {
  const start = wallParts(occurrence.startsAt);
  if (preference.weekdays.length > 0 && !preference.weekdays.includes(start.weekday)) return false;
  if (preference.startMinute === null || preference.endMinute === null) return true;

  const durationMinutes = (occurrence.endsAt.getTime() - occurrence.startsAt.getTime()) / 60_000;
  return start.minute >= preference.startMinute && start.minute + durationMinutes <= preference.endMinute;
}

/** ["seg", "qua", "sex"] → "Seg, qua e sex" (só a primeira com maiúscula). */
function joinDays(labels: string[]): string {
  const text = labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * O valor de um `<input type="time">` para um minuto do dia: vazio para nulo; a meia-noite do fim da
 * faixa (1440) vira "00:00", porque o campo não aceita "24:00" (o schema lê "00:00" como fim = 24:00).
 */
export function timeInputValue(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "";
  return formatTime(minutes === DAY_MINUTES ? 0 : minutes);
}

/** "Seg e qua, 14:00–18:00", "Qua, qualquer horário", "Qualquer dia, 14:00–18:00". */
export function describePreference(preference: Preference): string {
  const hasDays = preference.weekdays.length > 0;
  const hasWindow = preference.startMinute !== null && preference.endMinute !== null;
  if (!hasDays && !hasWindow) return "Qualquer dia e horário";

  const days = hasDays
    ? joinDays(WEEKDAY_ORDER.filter((day) => preference.weekdays.includes(day)).map((day) => WEEKDAY_SHORT[day]))
    : "Qualquer dia";
  const window =
    hasWindow && preference.startMinute !== null && preference.endMinute !== null
      ? `${formatTime(preference.startMinute)}–${formatTime(preference.endMinute)}`
      : "qualquer horário";
  return `${days}, ${window}`;
}
