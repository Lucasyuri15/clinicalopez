"use client";

import { useEffect, useRef, useState } from "react";

import { FormErrorBox, useFormAction } from "@/components/agenda/form-action";
import { Button } from "@/components/ui/button";
import { removeAttachmentAction } from "@/server/clinical/attachment-actions";

/** Remover um anexo, com uma confirmação (some da lista; o registro e o arquivo ficam guardados). */
export function RemoveAttachmentButton({ attachmentId, name }: { attachmentId: string; /** nome do arquivo (rótulo acessível) */ name: string }) {
  const [confirming, setConfirming] = useState(false);
  const { state, formAction, pending, errorRef } = useFormAction(removeAttachmentAction, () => setConfirming(false));

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
      <Button ref={triggerRef} type="button" variant="outline" size="sm" className="h-10 md:h-7" aria-label={`Remover ${name}`} onClick={() => setConfirming(true)}>
        Remover
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2" role="group" aria-label={`Confirmar: remover ${name}`}>
      <input type="hidden" name="attachmentId" value={attachmentId} />
      <FormErrorBox state={state} errorRef={errorRef} />
      <p className="text-sm">Remover este anexo? Ele deixa de aparecer na ficha, mas o registro e o arquivo ficam guardados.</p>
      <div className="flex gap-2">
        <Button ref={confirmRef} type="submit" size="sm" className="h-10 md:h-7" disabled={pending}>
          {pending ? "Removendo…" : "Confirmar"}
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-10 md:h-7" onClick={() => setConfirming(false)} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
