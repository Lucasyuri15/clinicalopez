"use client";

import { addAddendumAction } from "@/server/clinical/actions";

import { TextSheet } from "./note-sheet";

/** Adendo: correção ou complemento de uma evolução já finalizada (o texto original fica intacto). */
export function AddendumSheet({ noteId, label }: { noteId: string; /** "02/10/2031 14:00 · Avaliação" */ label: string }) {
  return (
    <TextSheet
      triggerText="Adicionar adendo"
      triggerLabel={`Adicionar adendo à evolução de ${label}`}
      title="Novo adendo"
      description={`${label}. O texto original continua como está; o adendo é acrescentado com a sua assinatura e a data.`}
      fieldLabel="Adendo"
      submitText="Salvar adendo"
      pendingText="Salvando…"
      action={addAddendumAction}
      idName="noteId"
      idValue={noteId}
    />
  );
}
