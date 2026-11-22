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

const ACTION_LABELS = {
  confirmed: "Confirmar atendimento",
  done: "Marcar como realizada",
  no_show: "Registrar falta",
} as const;

const CORRECTION_LABELS = {
  done: "Corrigir para realizada",
  no_show: "Corrigir para falta",
} as const;

/** Texto do botão que leva o atendimento de `from` para `to` (Realizada ↔ Falta é uma correção do admin). */
export function statusActionLabel(from: AppointmentStatus, to: "confirmed" | "done" | "no_show"): string {
  if ((from === "done" || from === "no_show") && to !== "confirmed") return CORRECTION_LABELS[to];
  return ACTION_LABELS[to];
}
