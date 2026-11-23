"use client";

import { NoConsentBadge } from "@/components/patients/consent-badge";
import { statusLabel } from "@/lib/appointments/labels";
import { seriesBadgeText } from "@/lib/appointments/series-format";
import { isStaffRole, type ActorRole } from "@/lib/appointments/status";
import { formatTimeBR } from "@/lib/datetime";
import type { AgendaItem } from "@/server/appointments/queries";

import { AppointmentSheet } from "./appointment-sheet";
import { AppointmentStatusBadge } from "./appointment-status-badge";

type Props = {
  item: AgendaItem;
  role: ActorRole;
  /** Cartão estreito (uma coluna da semana). */
  compact?: boolean;
};

/**
 * Um atendimento na lista: horário, paciente, serviço e situação. É um botão que abre a gaveta de
 * detalhe. O rótulo acessível traz tudo numa frase (não depende só de cor nem de posição).
 */
export function AppointmentCard({ item, role, compact = false }: Props) {
  const start = formatTimeBR(item.startsAt);
  const end = formatTimeBR(item.endsAt);
  const patient = item.patientName ?? "Paciente";
  // Só a equipe vê a série (defesa em profundidade: o servidor já não a manda ao profissional).
  const series = isStaffRole(role) ? item.series : null;
  // O nome acessível COMEÇA pelo texto visível ("09:00–09:50"; WCAG 2.5.3) e traz o aviso de consentimento.
  const label = `${start}–${end}, ${patient}, ${item.serviceName}, ${statusLabel(item.status)}${item.lacksDataConsent ? ", sem consentimento LGPD" : ""}${series?.position ? `, sessão ${series.position} de ${series.total} da série` : ""}`;
  const muted = item.status === "cancelled";

  return (
    <AppointmentSheet
      item={item}
      role={role}
      triggerLabel={label}
      triggerClassName={`flex min-h-11 w-full min-w-0 flex-col gap-1 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 ${muted ? "opacity-70" : ""}`}
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold tabular-nums">
          {start}–{end}
        </span>
        <AppointmentStatusBadge status={item.status} />
      </span>
      <span className={`min-w-0 break-words text-sm ${compact ? "" : "font-medium"}`}>{patient}</span>
      <span className="min-w-0 break-words text-xs text-muted-foreground">{item.serviceName}</span>
      {item.lacksDataConsent || series ? (
        <span className="flex flex-wrap items-center gap-1">
          {series ? (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium">{seriesBadgeText(series)}</span>
          ) : null}
          {item.lacksDataConsent ? <NoConsentBadge /> : null}
        </span>
      ) : null}
    </AppointmentSheet>
  );
}
