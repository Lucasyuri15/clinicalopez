import type { OccurrenceReason } from "./series";
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

/** Por que uma data da série não cabe, em palavras curtas para a prévia (sem dado de paciente). */
const OCCURRENCE_REASON_LABELS: Record<OccurrenceReason, string> = {
  past: "Já passou",
  invalid: "Horário inválido",
  "crosses-midnight": "Atravessa a meia-noite",
  "outside-grid": "Fora do atendimento do profissional",
  "time-off": "Folga ou bloqueio do profissional",
  "conflict-professional": "O profissional já tem atendimento",
  "conflict-patient": "O paciente já tem atendimento",
};

export function occurrenceReasonLabel(reason: OccurrenceReason): string {
  return OCCURRENCE_REASON_LABELS[reason];
}
