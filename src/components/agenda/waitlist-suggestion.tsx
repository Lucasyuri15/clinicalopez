"use client";

import { Button } from "@/components/ui/button";
import { formatSeriesSlot } from "@/lib/appointments/series-format";
import { formatTimeBR } from "@/lib/datetime";
import type { WaitlistSuggestion as Suggestion } from "@/server/appointments/actions";
import { bookFromWaitlistAction } from "@/server/waitlist/actions";

import { FormErrorBox, useFormAction } from "./form-action";
import { SummaryPanel } from "./series-section";

type Candidate = Suggestion["candidates"][number];

/** Um candidato e o botão Agendar (um formulário por cartão: cada recusa aparece no cartão certo). */
function CandidateCard({
  candidate,
  suggestion,
  onSaved,
}: {
  candidate: Candidate;
  suggestion: Suggestion;
  onSaved: () => void;
}) {
  const { state, formAction, pending, errorRef } = useFormAction(bookFromWaitlistAction, onSaved);
  return (
    <li className="p-2">
      <form action={formAction} className="flex flex-col gap-2" noValidate>
        {/* Só a espera, o profissional e o início: o paciente, o serviço e a duração o servidor lê. */}
        <input type="hidden" name="entryId" value={candidate.entryId} />
        <input type="hidden" name="professionalId" value={suggestion.professionalId} />
        <input type="hidden" name="startsAt" value={suggestion.startsAt} />
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="block break-words font-medium">{candidate.patientName}</span>
            <span className="block text-xs text-muted-foreground">
              {candidate.serviceName} · {formatTimeBR(suggestion.startsAt)}–{formatTimeBR(candidate.endsAt)}
            </span>
          </div>
          <Button type="submit" className="h-11 shrink-0" disabled={pending} aria-label={`Agendar ${candidate.patientName}, ${candidate.serviceName}`}>
            {pending ? "Agendando…" : "Agendar"}
          </Button>
        </div>
        <FormErrorBox state={state} errorRef={errorRef} />
      </form>
    </li>
  );
}

/**
 * O que a gaveta de cancelar mostra quando o horário liberado serve a alguém da lista de espera: quem
 * cabe, em ordem de chegada, e Agendar com um clique (ou Concluir para deixar como está). Nada é criado
 * sozinho: Agendar é um agendamento comum, conferido de novo no servidor.
 */
export function WaitlistSuggestion({ suggestion, onClose }: { suggestion: Suggestion; onClose: () => void }) {
  const count = suggestion.candidates.length;
  const who = count === 1 ? "1 pessoa da lista de espera cabe" : `${count} pessoas da lista de espera cabem`;
  return (
    <SummaryPanel intro={`Cancelado. ${formatSeriesSlot(suggestion.startsAt)} ficou livre e ${who} nele:`} onClose={onClose}>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border text-sm">
        {suggestion.candidates.map((candidate) => (
          <CandidateCard key={candidate.entryId} candidate={candidate} suggestion={suggestion} onSaved={onClose} />
        ))}
      </ul>
    </SummaryPanel>
  );
}
