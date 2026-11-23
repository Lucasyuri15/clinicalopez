"use client";

import { useActionState, useEffect, useRef, type RefObject } from "react";

import { FormError } from "@/components/auth/form-error";

/** O que um formulário da agenda precisa do estado que a ação devolve (a agenda e as séries cabem aqui). */
type FormState = { error?: string; success?: boolean } | undefined;

/**
 * Liga uma Server Action da agenda a um formulário: `onSaved` roda quando a ação devolve sucesso
 * (as gavetas fecham). `keepOpen` pode segurar a gaveta aberta quando há um resumo a mostrar antes
 * (ex.: datas de uma série que não couberam). Em erro, a mensagem sobe para o topo do formulário e
 * recebe o foco (num formulário que rola, principalmente no celular, quem toca em "Salvar" lá embaixo
 * não veria nada).
 */
export function useFormAction<S extends FormState>(
  action: (previous: S, formData: FormData) => Promise<S>,
  onSaved: () => void,
  keepOpen?: (result: NonNullable<S>) => boolean,
) {
  // O React tipa o estado como `Awaited<S>`, que o TypeScript não resolve para um genérico: o hook usa o
  // tipo base e o estado volta para quem chama já como `S`.
  const [base, formAction, pending] = useActionState<FormState, FormData>(async (previous, formData) => {
    const result = await action(previous as S, formData);
    if (result?.success && !keepOpen?.(result as NonNullable<S>)) onSaved();
    return result;
  }, undefined);
  const state = base as S;

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
  /** Qualquer estado de formulário que possa trazer uma mensagem de erro (agenda ou séries). */
  state: { error?: string } | undefined;
  errorRef: RefObject<HTMLDivElement | null>;
}) {
  if (!state?.error) return null;
  return (
    <div ref={errorRef} tabIndex={-1} className="outline-none">
      <FormError message={state.error} />
    </div>
  );
}
