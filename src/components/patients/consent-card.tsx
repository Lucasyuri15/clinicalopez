import { ConsentSheet } from "@/components/patients/consent-sheet";
import { ConsentStatusBadge } from "@/components/patients/consent-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTimeBR } from "@/lib/datetime";
import {
  CONSENT_GIVEN_BY_LABELS,
  CONSENT_KIND_LABELS,
  CONSENT_KINDS,
  CONSENT_METHOD_LABELS,
  consentStatus,
  currentConsents,
  type ConsentEvent,
} from "@/lib/patients/consents";
import { formatBirthDate } from "@/lib/patients/labels";

type Props = {
  patientId: string;
  patientName: string;
  today: string;
  /** Histórico completo, do mais recente para o mais antigo (`listConsents`). Só admin e recepção. */
  events: ConsentEvent[];
};

/** "20/11/2026 · Papel assinado · Paciente" */
function summary(event: ConsentEvent): string {
  return [
    formatBirthDate(event.occurredOn),
    CONSENT_METHOD_LABELS[event.method],
    CONSENT_GIVEN_BY_LABELS[event.givenBy],
  ].join(" · ");
}

/**
 * Consentimentos LGPD do paciente: o estado atual de cada tipo e o histórico (só de inclusão).
 * Só admin e recepção chegam aqui (o profissional nunca recebe o histórico: a RLS não devolve linha).
 */
export function ConsentCard({ patientId, patientName, today, events }: Props) {
  const current = currentConsents(events);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Consentimentos (LGPD)</h2>
          <ConsentSheet patientId={patientId} patientName={patientName} today={today} />
        </div>

        <ul className="flex flex-col gap-3 text-sm" aria-label="Estado atual dos consentimentos">
          {CONSENT_KINDS.map((kind) => {
            const event = current[kind];
            return (
              <li key={kind} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{CONSENT_KIND_LABELS[kind]}</span>
                  <ConsentStatusBadge status={consentStatus(event)} />
                </div>
                <p className="text-muted-foreground">
                  {event
                    ? summary(event)
                    : kind === "data_processing"
                      ? "Ainda não registrado. Registre o consentimento antes de seguir com o atendimento."
                      : "Ainda não registrado. Sem ele, não enviamos mensagens por WhatsApp."}
                </p>
              </li>
            );
          })}
        </ul>

        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Histórico ({events.length})</summary>
          {events.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">Nenhum consentimento registrado.</p>
          ) : (
            <ol className="mt-3 flex flex-col gap-3 text-sm" aria-label="Histórico de consentimentos">
              {events.map((event) => (
                <li key={event.id} className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
                  <p className="font-medium">
                    {event.granted ? "Concedeu" : "Revogou"} · {CONSENT_KIND_LABELS[event.kind]}
                  </p>
                  <p className="text-muted-foreground">{summary(event)}</p>
                  {event.note ? <p className="whitespace-pre-wrap break-words">{event.note}</p> : null}
                  <p className="text-xs text-muted-foreground">
                    Registrado por {event.registeredByName ?? "outro usuário"} em {formatDateTimeBR(event.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </details>
      </CardContent>
    </Card>
  );
}
