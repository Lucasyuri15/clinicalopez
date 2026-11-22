import type { AppointmentStatus } from "./status";

/** Rótulos dos status em pt-BR, como aparecem nas telas. */
export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Agendada",
  confirmed: "Confirmada",
  done: "Realizada",
  no_show: "Falta",
  cancelled: "Cancelada",
};

export function statusLabel(status: AppointmentStatus): string {
  return STATUS_LABELS[status];
}
