"use client";

import { useEffect, useRef, useState } from "react";

import { FormErrorBox, useFormAction } from "@/components/agenda/form-action";
import { Button } from "@/components/ui/button";
import { removeWaitlistAction } from "@/server/waitlist/actions";

/** Tirar da espera, com uma confirmação (não dá para desfazer: quem sai da espera é posto de novo). */
export function RemoveFromWaitlistButton({ id, patientName }: { id: string; patientName: string }) {
  const [confirming, setConfirming] = useState(false);
  const { state, formAction, pending, errorRef } = useFormAction(removeWaitlistAction, () => setConfirming(false));

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
        aria-label={`Tirar da espera de ${patientName}`}
        onClick={() => setConfirming(true)}
      >
        Tirar da espera
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2" role="group" aria-label={`Confirmar: tirar ${patientName} da espera`}>
      <input type="hidden" name="id" value={id} />
      <FormErrorBox state={state} errorRef={errorRef} />
      <p className="text-sm">Tirar {patientName} da espera?</p>
      <div className="flex gap-2">
        <Button ref={confirmRef} type="submit" variant="destructive" size="sm" className="h-10 md:h-7" disabled={pending}>
          {pending ? "Tirando…" : "Confirmar"}
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-10 md:h-7" onClick={() => setConfirming(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
