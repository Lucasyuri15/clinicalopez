import { CONSENT_STATUS_LABELS, type ConsentStatus } from "@/lib/patients/consents";

/**
 * Aviso de que falta o consentimento LGPD de tratamento de dados (só admin e recepção veem).
 * Não depende só da cor: o texto está sempre visível. A cor de status é separada da cor da marca.
 */
export function NoConsentBadge() {
  return (
    <span className="rounded-full bg-status-absent px-2 py-0.5 text-xs font-medium text-status-absent-foreground">
      Sem consentimento LGPD
    </span>
  );
}

/** Estado de um tipo de consentimento (concedido, revogado, não registrado). */
export function ConsentStatusBadge({ status }: { status: ConsentStatus }) {
  const style =
    status === "granted"
      ? "bg-status-confirmed text-status-confirmed-foreground"
      : status === "revoked"
        ? "bg-status-absent text-status-absent-foreground"
        : "border border-dashed border-muted-foreground/50 text-muted-foreground";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>{CONSENT_STATUS_LABELS[status]}</span>
  );
}
