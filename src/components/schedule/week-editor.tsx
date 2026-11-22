"use client";

import { PlusIcon } from "lucide-react";
import { useActionState, useState } from "react";

import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTime, parseTime, WEEKDAY_ORDER, weekdayLabel } from "@/lib/schedule/time";
import type { WorkRange } from "@/lib/schedule/week";
import { saveWeekAction, type ScheduleFormState } from "@/server/schedule/actions";

type Row = { key: string; weekday: number; start: string; end: string };

/** Chave de faixa nova. Um contador (e não `crypto.randomUUID`, que não existe fora de HTTPS, como no celular em rede local). */
let rangeCounter = 0;
type State = (NonNullable<ScheduleFormState> & { submitted?: string }) | undefined;

/** `<input type="time">` não mostra "24:00": um fim às 24:00 (só possível fora da tela) aparece vazio. */
const toInput = (minutes: number) => (minutes >= 1440 ? "" : formatTime(minutes));

/** Faixa nova: continua de onde a última do dia termina (ou 08:00–12:00 no dia vazio). */
function nextRange(rows: readonly Row[], weekday: number): { start: string; end: string } {
  const last = rows.filter((row) => row.weekday === weekday).map((row) => parseTime(row.end)).filter((m) => m !== null).at(-1);
  const start = last !== undefined && last <= 1380 ? last : 480;
  return { start: formatTime(start), end: formatTime(Math.min(start + 240, 1435)) };
}

/**
 * Editor da grade semanal (administrador e recepção): por dia, uma ou mais faixas de atendimento; o
 * intervalo é o vão entre faixas. Um só "Salvar" grava a semana inteira (substitui o conjunto).
 * O servidor revalida tudo (formato, 5 em 5 minutos, sobreposição).
 */
export function WeekEditor({ professionalId, initial }: { professionalId: string; initial: WorkRange[] }) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((range, index) => ({
      key: `inicial-${index}`,
      weekday: range.weekday,
      start: toInput(range.start),
      end: toInput(range.end),
    })),
  );
  const [state, action, pending] = useActionState(
    async (previous: State, formData: FormData): Promise<State> => {
      const result = await saveWeekAction(previous, formData);
      return { ...result, submitted: String(formData.get("ranges") ?? "") };
    },
    undefined,
  );

  const json = JSON.stringify(rows.map(({ weekday, start, end }) => ({ weekday, start, end })));
  // "Salvo" só enquanto a tela é igual ao que foi enviado (editar depois apaga o aviso).
  const showSaved = state?.success === true && state.submitted === json;

  const update = (key: string, field: "start" | "end", value: string) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, [field]: value } : row)));

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="professionalId" value={professionalId} />
      <input type="hidden" name="ranges" value={json} />
      <FormError message={state?.error} />

      {WEEKDAY_ORDER.map((weekday) => {
        const day = weekdayLabel(weekday);
        const dayRows = rows.filter((row) => row.weekday === weekday);
        return (
          <fieldset key={weekday} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">{day}</legend>
            {dayRows.length === 0 ? <p className="text-sm text-muted-foreground">Sem atendimento</p> : null}
            {dayRows.map((row, index) => (
              <div key={row.key} className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Início
                  <Input
                    type="time"
                    step={300}
                    value={row.start}
                    onChange={(event) => update(row.key, "start", event.target.value)}
                    aria-label={`${day}, faixa ${index + 1}, início`}
                    className="w-32"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                  Fim
                  <Input
                    type="time"
                    step={300}
                    value={row.end}
                    onChange={(event) => update(row.key, "end", event.target.value)}
                    aria-label={`${day}, faixa ${index + 1}, fim`}
                    className="w-32"
                    required
                  />
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-11 md:h-8"
                  onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                  aria-label={`Remover faixa ${index + 1} de ${day}`}
                >
                  Remover
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 md:h-7"
                onClick={() =>
                  setRows((current) => [
                    ...current,
                    { key: `nova-${++rangeCounter}`, weekday, ...nextRange(current, weekday) },
                  ])
                }
                aria-label={`Adicionar faixa em ${day}`}
              >
                <PlusIcon aria-hidden="true" />
                Adicionar faixa
              </Button>
            </div>
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="h-11 text-base">
          {pending ? "Salvando…" : "Salvar horários"}
        </Button>
        {/* Região sempre presente: leitores de tela anunciam mudanças de texto, não um elemento que acaba de surgir. */}
        <p role="status" className="text-sm text-muted-foreground">
          {showSaved ? "Horários salvos." : ""}
        </p>
      </div>
    </form>
  );
}
