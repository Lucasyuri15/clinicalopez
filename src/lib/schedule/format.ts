import { formatDateBR, formatTimeBR } from "@/lib/datetime";

const MINUTE = 60 * 1000;

/**
 * Descreve uma folga ou bloqueio para a tela, em horário de Brasília:
 * - dias inteiros (começa e termina à meia-noite): "24/12/2026 a 26/12/2026 (dia inteiro)" —
 *   o fim guardado é a meia-noite DEPOIS do último dia, então mostra o dia anterior a ele;
 * - parcial no mesmo dia: "24/12/2026 das 14:00 às 18:30";
 * - parcial atravessando dias: "24/12/2026 18:00 até 26/12/2026 08:00".
 */
export function describeTimeOff(startsAt: Date, endsAt: Date): string {
  const startsAtMidnight = formatTimeBR(startsAt) === "00:00";
  const endsAtMidnight = formatTimeBR(endsAt) === "00:00";
  const firstDay = formatDateBR(startsAt);

  if (startsAtMidnight && endsAtMidnight) {
    const lastDay = formatDateBR(new Date(endsAt.getTime() - MINUTE));
    return lastDay === firstDay ? `${firstDay} (dia inteiro)` : `${firstDay} a ${lastDay} (dia inteiro)`;
  }
  const endDay = formatDateBR(endsAt);
  if (endDay === firstDay) return `${firstDay} das ${formatTimeBR(startsAt)} às ${formatTimeBR(endsAt)}`;
  return `${firstDay} ${formatTimeBR(startsAt)} até ${endDay} ${formatTimeBR(endsAt)}`;
}
