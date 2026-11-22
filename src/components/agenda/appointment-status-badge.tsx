import { statusLabel } from "@/lib/appointments/labels";
import type { AppointmentStatus } from "@/lib/appointments/status";

/** Classes literais (o Tailwind só gera o que enxerga no código). Cores de status ≠ cor da marca. */
const STYLES: Record<AppointmentStatus, string> = {
  scheduled: "bg-status-scheduled text-status-scheduled-foreground",
  confirmed: "bg-status-confirmed text-status-confirmed-foreground",
  done: "bg-status-done text-status-done-foreground",
  no_show: "bg-status-absent text-status-absent-foreground",
  cancelled: "bg-status-cancelled text-status-cancelled-foreground",
};

/** Situação do atendimento. Não depende só da cor: o texto ("Agendada", "Falta"...) está sempre visível. */
export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>{statusLabel(status)}</span>
  );
}
