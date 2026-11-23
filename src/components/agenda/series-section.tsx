"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { occurrenceReasonLabel } from "@/lib/appointments/labels";
import { SERIES_MAX_SESSIONS, SERIES_MIN_SESSIONS } from "@/lib/appointments/series";
import { createdSummaryText, formatSeriesSlot, previewSummary, previewSummaryText } from "@/lib/appointments/series-format";
import { WEEKDAY_ORDER, weekdayLabel } from "@/lib/schedule/time";
import type { SeriesFormState, SeriesRow } from "@/server/appointments/series-actions";

import { SeriesPreviewList } from "./series-preview-list";

/**
 * A prévia vale para os dados do momento em que foi calculada: mexer em qualquer campo depois dela a
 * deixa velha. Guarda QUAL estado estava na tela quando a pessoa mexeu; um estado novo (outra prévia)
 * nunca está velho, e não precisa de efeito para "zerar". Enquanto a prévia CALCULA, os campos ficam
 * desabilitados (`<fieldset disabled>` nos formulários): sem isso, uma edição feita no meio do cálculo
 * chegaria "fresca" e o botão Criar gravaria dados diferentes dos que foram mostrados.
 */
export function useStalePreview(state: SeriesFormState) {
  const [editedAfter, setEditedAfter] = useState<SeriesFormState | "nunca">("nunca");
  return { stale: state !== undefined && editedAfter === state, onEdit: () => setEditedAfter(state) };
}

const FIELD = "flex flex-col gap-1.5";
const LABEL = "text-sm font-medium";
const HELP = "text-xs text-muted-foreground";

/** O estado tem um resumo a mostrar: criou/renovou e alguma data ficou de fora. */
export const hasSkippedSummary = (state: SeriesFormState): boolean => Boolean(state?.success && state.skipped?.length);

/**
 * O resumo que SUBSTITUI o formulário (uma frase, a lista e o botão Concluir). Recebe o foco ao aparecer:
 * o botão que a pessoa tocou (Criar) some junto com o formulário, e sem isso o foco se perderia.
 */
export function SummaryPanel({ intro, children, onClose }: { intro: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 outline-none">
      <p className="text-sm font-medium">{intro}</p>
      {children}
      <Button type="button" className="h-11" onClick={onClose}>
        Concluir
      </Button>
    </div>
  );
}

/** Depois de criar ou renovar com datas puladas: quais foram e por quê. */
export function SkippedSummary({ created, skipped, onClose }: { created: number; skipped: SeriesRow[]; onClose: () => void }) {
  return (
    <SummaryPanel intro={createdSummaryText(created, skipped.length)} onClose={onClose}>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border text-sm">
        {skipped.map((row) => (
          <li key={row.startsAt} className="p-2">
            <span className="block">{formatSeriesSlot(row.startsAt)}</span>
            <span className="block text-xs font-medium text-destructive">{row.reason ? occurrenceReasonLabel(row.reason) : ""}</span>
          </li>
        ))}
      </ul>
      <p className={HELP}>Se precisar, agende essas datas à mão como atendimentos avulsos.</p>
    </SummaryPanel>
  );
}

type SeriesSectionProps = {
  /** Dia da semana marcado de início (0 = domingo), quando o servidor ainda não devolveu os dias. */
  defaultWeekday: number;
  /** Prefixo dos ids dos campos (a criação e a renovação podem estar na mesma tela). */
  idPrefix: string;
  values: Record<string, string> | undefined;
  resetKey: (name: string) => string;
  state: SeriesFormState;
  stale: boolean;
  pending: boolean;
};

/** Dias da semana, número de sessões, prévia e os botões da série (dentro do mesmo formulário). */
export function SeriesSection({ defaultWeekday, idPrefix, values, resetKey, state, stale, pending }: SeriesSectionProps) {
  // Os dias voltam do servidor como "1,3" (ou "" se a pessoa desmarcou todos: não remarcar sozinho).
  const checked = new Set(
    values === undefined || values.weekdays === undefined
      ? [defaultWeekday]
      : values.weekdays.split(",").filter(Boolean).map(Number),
  );
  const preview = state?.preview;
  const fits = preview ? previewSummary(preview).fits : 0;

  // Qual botão foi tocado: só ele mostra "Calculando…" ou "Criando…" (o outro mantém o próprio texto).
  const [chosen, setChosen] = useState<"preview" | "create" | null>(null);

  // A prévia nova chega abaixo do botão e pode ser longa (até 60 datas): traz para a vista.
  const resultRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (preview) resultRef.current?.scrollIntoView({ block: "nearest" });
  }, [preview]);

  return (
    <fieldset disabled={pending} className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">Repetir semanalmente</legend>

      <div role="group" aria-label="Dias da semana" className="flex flex-wrap gap-2">
        {WEEKDAY_ORDER.map((day) => (
          <label key={day} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm md:min-h-8">
            <input
              key={`weekday-${day}-${values?.weekdays ?? "inicial"}`}
              type="checkbox"
              name="weekdays"
              value={String(day)}
              defaultChecked={checked.has(day)}
              className="size-4"
            />
            <span aria-hidden="true">{weekdayLabel(day).slice(0, 3)}</span>
            <span className="sr-only">{weekdayLabel(day)}</span>
          </label>
        ))}
      </div>

      <div className={FIELD}>
        <label htmlFor={`${idPrefix}-count`} className={LABEL}>
          Número de sessões
        </label>
        <Input
          key={`count-${resetKey("count")}`}
          id={`${idPrefix}-count`}
          name="count"
          type="number"
          inputMode="numeric"
          min={SERIES_MIN_SESSIONS}
          max={SERIES_MAX_SESSIONS}
          step={1}
          defaultValue={values?.count ?? "10"}
          aria-describedby={`${idPrefix}-count-help`}
        />
        <p id={`${idPrefix}-count-help`} className={HELP}>
          De {SERIES_MIN_SESSIONS} a {SERIES_MAX_SESSIONS} sessões, em até 1 ano. A série começa na data escolhida (ou no
          primeiro dia marcado a partir dela), no mesmo horário.
        </p>
      </div>

      <Button
        type="submit"
        name="intent"
        value="preview"
        variant="secondary"
        className="h-11"
        disabled={pending}
        onClick={() => setChosen("preview")}
      >
        {pending && chosen === "preview" ? "Calculando…" : "Ver prévia"}
      </Button>

      {/* Região de status SEMPRE montada: leitores de tela anunciam o que muda dentro dela, e não uma que nasce já com texto. */}
      <div role="status" aria-live="polite" className="sr-only">
        {preview ? previewSummaryText(preview) : ""}
      </div>

      <div ref={resultRef} className="flex flex-col gap-3">
        {preview ? <SeriesPreviewList rows={preview} /> : null}

        {preview && stale ? <p className={HELP}>Você mudou os dados depois da prévia. Veja a prévia de novo para criar.</p> : null}

        {preview && !stale ? (
          <>
            <Button
              type="submit"
              name="intent"
              value="create"
              className="h-11"
              disabled={pending || fits === 0}
              onClick={() => setChosen("create")}
            >
              {pending && chosen === "create" ? "Criando…" : fits === 0 ? "Nenhuma data cabe" : `Criar ${fits} ${fits === 1 ? "sessão" : "sessões"}`}
            </Button>
            {fits > 0 && fits < preview.length ? (
              <p className={HELP}>Só as datas que cabem serão criadas; as outras ficam de fora e você poderá agendá-las à mão.</p>
            ) : null}
          </>
        ) : null}
      </div>
    </fieldset>
  );
}
