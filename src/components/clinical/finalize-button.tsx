"use client";

import { useEffect, useRef, useState } from "react";

import { FormErrorBox, useFormAction } from "@/components/agenda/form-action";
import { Button } from "@/components/ui/button";
import { finalizeNoteAction } from "@/server/clinical/actions";

/** Finalizar a evolução, com uma confirmação (depois disso o texto fica trancado: só adendo). */
export function FinalizeNoteButton({ noteId, label }: { noteId: string; /** "13/10/2031 14:00 · Sessão" */ label: string }) {
  const [confirming, setConfirming] = useState(false);
  const { state, formAction, pending, errorRef } = useFormAction(finalizeNoteAction, () => setConfirming(false));

  // O botão some ao abrir a confirmação: leva o foco para "Confirmar" e, ao cancelar, devolve-o ao botão.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) triggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  if (!confirming) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="sm"
        className="h-10 md:h-7"
        aria-label={`Finalizar a evolução de ${label}`}
        onClick={() => setConfirming(true)}
      >
        Finalizar
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2" role="group" aria-label={`Confirmar: finalizar a evolução de ${label}`}>
      <input type="hidden" name="noteId" value={noteId} />
      <FormErrorBox state={state} errorRef={errorRef} />
      <p className="text-sm">Finalizar esta evolução? Depois de finalizada não dá para editar o texto; só acrescentar adendo.</p>
      <div className="flex gap-2">
        <Button ref={confirmRef} type="submit" size="sm" className="h-10 md:h-7" disabled={pending}>
          {pending ? "Finalizando…" : "Confirmar"}
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-10 md:h-7" onClick={() => setConfirming(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
