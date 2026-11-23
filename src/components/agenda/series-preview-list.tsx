import { CheckIcon, XIcon } from "lucide-react";

import { occurrenceReasonLabel } from "@/lib/appointments/labels";
import { formatSeriesSlot, previewSummaryText } from "@/lib/appointments/series-format";
import type { SeriesRow } from "@/server/appointments/series-actions";

/**
 * A prévia de uma série: uma linha por data, dizendo se cabe ou por que não. NÃO depende só de cor:
 * cada linha traz o ícone e o texto ("Cabe" ou o motivo). O anúncio para leitores de tela fica numa
 * região de status que já existe na tela (`SeriesSection`): uma que nasce junto com o texto muitas vezes
 * não é lida. Só mostra datas e motivos: nenhum dado do paciente.
 */
export function SeriesPreviewList({ rows }: { rows: SeriesRow[] }) {
  return (
    <section aria-label="Prévia da série" className="flex flex-col gap-2">
      <p className="text-sm font-medium">{previewSummaryText(rows)}</p>
      <ol className="flex flex-col divide-y divide-border rounded-lg border border-border text-sm">
        {rows.map((row) => (
          <li key={row.startsAt} className="flex items-start gap-2 p-2">
            {row.reason === null ? (
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            ) : (
              <XIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block">{formatSeriesSlot(row.startsAt)}</span>
              <span className={`block text-xs ${row.reason === null ? "text-muted-foreground" : "font-medium text-destructive"}`}>
                {row.reason === null ? "Cabe" : occurrenceReasonLabel(row.reason)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
