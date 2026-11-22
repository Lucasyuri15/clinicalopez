"use client";

import { useActionState, useEffect, useRef, type RefObject } from "react";

import { FormError } from "@/components/auth/form-error";
import type { AppointmentFormState } from "@/server/appointments/actions";

type Action = (previous: AppointmentFormState, formData: FormData) => Promise<AppointmentFormState>;

/**
 * Liga uma Server Action da agenda a um formulário: `onSaved` roda quando a ação devolve sucesso
 * (as gavetas fecham). Em erro, a mensagem sobe para o topo do formulário e recebe o foco (num
 * formulário que rola, principalmente no celular, quem toca em "Salvar" lá embaixo não veria nada).
 */
export function useFormAction(action: Action, onSaved: () => void) {
  const [state, formAction, pending] = useActionState(async (previous: AppointmentFormState, formData: FormData) => {
    const result = await action(previous, formData);
    if (result?.success) onSaved();
    return result;
  }, undefined);

  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state?.error) return;
    errorRef.current?.scrollIntoView({ block: "nearest" });
    errorRef.current?.focus();
  }, [state]);

  return { state, formAction, pending, errorRef };
}

export function FormErrorBox({
  state,
  errorRef,
}: {
  state: AppointmentFormState;
  errorRef: RefObject<HTMLDivElement | null>;
}) {
  if (!state?.error) return null;
  return (
    <div ref={errorRef} tabIndex={-1} className="outline-none">
      <FormError message={state.error} />
    </div>
  );
}
