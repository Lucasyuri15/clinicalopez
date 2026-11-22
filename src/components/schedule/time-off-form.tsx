"use client";

import { useActionState, useState } from "react";

import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REASON_MAX } from "@/lib/schedule/schemas";
import { addTimeOffAction, type ScheduleFormState } from "@/server/schedule/actions";

type State = (NonNullable<ScheduleFormState> & { at?: number }) | undefined;

/** Adicionar uma folga ou bloqueio (administrador e recepção). Datas e horários são os de Brasília. */
export function TimeOffForm({ professionalId }: { professionalId: string }) {
  const [state, action, pending] = useActionState(
    async (previous: State, formData: FormData): Promise<State> => {
      const result = await addTimeOffAction(previous, formData);
      return { ...result, at: Date.now() };
    },
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="professionalId" value={professionalId} />
      <FormError message={state?.error} />
      {/* Remonta a cada resposta: depois de um ERRO os campos voltam com o que foi digitado, e depois
          de um SUCESSO voltam limpos (o React já limpa o formulário; isto mantém o estado em dia). */}
      <TimeOffFields key={state?.at ?? "novo"} values={state?.values} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="h-11 text-base">
          {pending ? "Adicionando…" : "Adicionar folga ou bloqueio"}
        </Button>
        {/* Região sempre presente: leitores de tela anunciam mudanças de texto, não um elemento que acaba de surgir. */}
        <p role="status" className="text-sm text-muted-foreground">
          {state?.success ? "Adicionado." : ""}
        </p>
      </div>
    </form>
  );
}

function TimeOffFields({ values }: { values?: Record<string, string> }) {
  const [allDay, setAllDay] = useState(values ? values.allDay === "on" : true);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="off-start-date" className="text-sm font-medium">
            Data de início
          </label>
          <Input id="off-start-date" name="startDate" type="date" defaultValue={values?.startDate ?? ""} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="off-end-date" className="text-sm font-medium">
            Data de término
          </label>
          <Input id="off-end-date" name="endDate" type="date" defaultValue={values?.endDate ?? ""} required />
        </div>
      </div>

      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="allDay"
          checked={allDay}
          onChange={(event) => setAllDay(event.target.checked)}
          className="size-5 accent-brand"
        />
        <span>Dia inteiro</span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="off-start-time" className="text-sm font-medium">
            Horário de início
          </label>
          <Input
            id="off-start-time"
            name="startTime"
            type="time"
            step={300}
            defaultValue={values?.startTime ?? ""}
            disabled={allDay}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="off-end-time" className="text-sm font-medium">
            Horário de fim
          </label>
          <Input
            id="off-end-time"
            name="endTime"
            type="time"
            step={300}
            defaultValue={values?.endTime ?? ""}
            disabled={allDay}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="off-reason" className="text-sm font-medium">
          Motivo (opcional)
        </label>
        <Input
          id="off-reason"
          name="reason"
          defaultValue={values?.reason ?? ""}
          maxLength={REASON_MAX}
          autoComplete="off"
          aria-describedby="off-reason-help"
        />
        <p id="off-reason-help" className="text-xs text-muted-foreground">
          A recepção e o próprio profissional veem este texto. Não registre dados de saúde.
        </p>
      </div>
    </>
  );
}
