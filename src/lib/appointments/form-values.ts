import { wallParts } from "@/lib/datetime";
import { formatTime } from "@/lib/schedule/time";

/**
 * Valores de formulário (tudo texto, em horário de Brasília) para remarcar um atendimento: data,
 * hora de início e duração em minutos. A duração é a real (fim − início), sem depender do relógio
 * de parede (um dia de horário de verão tem 23 h ou 25 h).
 */
export function slotFormValues(slot: { startsAt: Date; endsAt: Date }): {
  date: string;
  startTime: string;
  durationMinutes: string;
} {
  const start = wallParts(slot.startsAt);
  return {
    date: start.date,
    startTime: formatTime(start.minute),
    durationMinutes: String(Math.round((slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000)),
  };
}
