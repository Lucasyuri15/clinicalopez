"use client";

import { useState } from "react";

import { FormErrorBox, useFormAction } from "@/components/agenda/form-action";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { type ClinicalFormState, saveNoteAction } from "@/server/clinical/actions";

const TEXTAREA =
  "min-h-64 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

type TextSheetProps = {
  triggerText: string;
  triggerLabel: string;
  title: string;
  description: string;
  fieldLabel: string;
  submitText: string;
  pendingText: string;
  action: (previous: ClinicalFormState, formData: FormData) => Promise<ClinicalFormState>;
  /** O campo escondido que diz a que o texto pertence (`appointmentId` ou `noteId`). */
  idName: string;
  idValue: string;
  initialBody?: string;
};

/**
 * Gaveta de texto clínico (evolução ou adendo). O formulário nasce DENTRO da gaveta: ao reabrir fica
 * limpo. Em erro, o texto digitado volta pelo `values` da ação (o React limpa o formulário depois de
 * cada ação e o profissional não pode perder o que escreveu).
 */
export function TextSheet(props: TextSheetProps) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" className="h-10 md:h-7">
            {props.triggerText}
          </Button>
        }
        aria-label={props.triggerLabel}
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{props.title}</SheetTitle>
          <SheetDescription>{props.description}</SheetDescription>
        </SheetHeader>
        <TextForm {...props} onSaved={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function TextForm(props: TextSheetProps & { onSaved: () => void }) {
  const { state, formAction, pending, errorRef } = useFormAction(props.action, props.onSaved);
  const fieldId = `clinical-${props.idName}-${props.idValue}`;
  const body = state?.values?.body ?? props.initialBody ?? "";
  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4" noValidate>
      <input type="hidden" name={props.idName} value={props.idValue} />
      <FormErrorBox state={state} errorRef={errorRef} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium">
          {props.fieldLabel}
        </label>
        {/* `key` = o texto que o servidor devolveu: ao chegar um erro, o campo remonta com o que foi digitado. */}
        <textarea key={body} id={fieldId} name="body" defaultValue={body} className={TEXTAREA} />
      </div>
      <Button type="submit" className="h-11 md:h-8" disabled={pending}>
        {pending ? props.pendingText : props.submitText}
      </Button>
    </form>
  );
}

/** Escrever (ou continuar) a evolução de um atendimento Realizado: só rascunho; finalizar é outro botão. */
export function NoteSheet({
  appointmentId,
  label,
  initialBody,
  mode,
}: {
  appointmentId: string;
  /** "06/10/2031 14:00 · Sessão": identifica o atendimento no rótulo acessível. */
  label: string;
  initialBody?: string;
  mode: "create" | "edit";
}) {
  const creating = mode === "create";
  return (
    <TextSheet
      triggerText={creating ? "Escrever evolução" : "Continuar"}
      triggerLabel={creating ? `Escrever evolução de ${label}` : `Continuar a evolução de ${label}`}
      title="Evolução do atendimento"
      description={`${label}. Salve como rascunho quantas vezes quiser; depois de finalizada, só dá para acrescentar adendo.`}
      fieldLabel="Evolução"
      submitText="Salvar rascunho"
      pendingText="Salvando…"
      action={saveNoteAction}
      idName="appointmentId"
      idValue={appointmentId}
      initialBody={initialBody}
    />
  );
}
