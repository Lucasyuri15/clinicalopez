"use client";

import { PlusIcon } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";

import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  CONSENT_GIVEN_BY,
  CONSENT_GIVEN_BY_LABELS,
  CONSENT_KIND_LABELS,
  CONSENT_KINDS,
  CONSENT_METHOD_LABELS,
  CONSENT_METHODS,
  CONSENT_NOTE_MAX,
  CONSENT_DATE_MIN,
} from "@/lib/patients/consents";
import { registerConsentAction, type ConsentFormState } from "@/server/patients/consent-actions";

type Props = {
  patientId: string;
  patientName: string;
  /** Hoje em Brasília ("AAAA-MM-DD"): é a data sugerida e o limite (não aceita data futura). */
  today: string;
};

const FIELD = "flex flex-col gap-1.5";
const LABEL = "text-sm font-medium";
const HELP = "text-xs text-muted-foreground";
const TEXTAREA =
  "min-h-20 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

/**
 * Registrar um consentimento LGPD (admin e recepção), numa gaveta lateral. O histórico é só de
 * inclusão: um erro de digitação se corrige registrando um novo evento (com a nota explicando).
 */
export function ConsentSheet({ patientId, patientName, today }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" className="h-10 md:h-7">
            <PlusIcon aria-hidden="true" />
            Registrar consentimento
          </Button>
        }
        aria-label={`Registrar consentimento de ${patientName}`}
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Registrar consentimento</SheetTitle>
          <SheetDescription>
            Fica no histórico e não pode ser alterado nem apagado. Para corrigir um registro, lance um novo.
          </SheetDescription>
        </SheetHeader>
        {/* Formulário DENTRO da gaveta: ao reabrir ele nasce limpo, sem erro nem texto antigo. */}
        <ConsentForm patientId={patientId} today={today} onSaved={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function ConsentForm({ patientId, today, onSaved }: Omit<Props, "patientName"> & { onSaved: () => void }) {
  const [state, action, pending] = useActionState(
    async (previous: ConsentFormState, formData: FormData) => {
      const result = await registerConsentAction(previous, formData);
      if (result?.success) onSaved();
      return result;
    },
    undefined,
  );
  const values = state?.values;
  // A mensagem fica no topo de um formulário que rola: sem isto, quem toca em "Registrar" lá embaixo
  // (principalmente no celular) não vê o erro e acha que nada aconteceu.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state?.error) return;
    errorRef.current?.scrollIntoView({ block: "nearest" });
    errorRef.current?.focus();
  }, [state]);

  const idPrefix = `consent-${patientId}`;
  /** Valor ao reabrir depois de um erro (o React limpa o formulário depois de cada ação). */
  const text = (name: string, fallback: string) => values?.[name] ?? fallback;
  // `key` de cada campo = o valor que o SERVIDOR devolveu para ele (como em `patient-sheet.tsx`):
  // quando a resposta chega com um valor diferente, o campo remonta e mostra esse valor; se for o
  // mesmo, o reset do formulário volta ao `defaultValue`, que já é ele. NÃO derivar a chave de um
  // contador incrementado na ação: ele muda antes de `state` chegar e remonta com os valores velhos.
  const resetKey = (name: string) => values?.[name] ?? "inicial";
  const [noteLength, setNoteLength] = useState((values?.note ?? "").length);

  return (
    <form action={action} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4" noValidate>
      <input type="hidden" name="patientId" value={patientId} />
      {state?.error ? (
        <div ref={errorRef} tabIndex={-1} className="outline-none">
          <FormError message={state.error} />
        </div>
      ) : null}

      <div className={FIELD}>
        <label htmlFor={`${idPrefix}-kind`} className={LABEL}>
          Tipo de consentimento
        </label>
        <NativeSelect key={`kind-${resetKey("kind")}`} id={`${idPrefix}-kind`} name="kind" defaultValue={text("kind", "data_processing")}>
          {CONSENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {CONSENT_KIND_LABELS[kind]}
            </option>
          ))}
        </NativeSelect>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className={`${LABEL} mb-1`}>O que aconteceu</legend>
        {[
          { value: "true", label: "Concedeu o consentimento" },
          { value: "false", label: "Revogou o consentimento" },
        ].map((option) => (
          <label key={option.value} className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-sm">
            <input
              key={`granted-${option.value}-${resetKey("granted")}`}
              type="radio"
              name="granted"
              value={option.value}
              defaultChecked={values?.granted === option.value}
              className="size-5 accent-brand"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>

      <div className={FIELD}>
        <label htmlFor={`${idPrefix}-given-by`} className={LABEL}>
          Quem deu o consentimento
        </label>
        <NativeSelect key={`given-${resetKey("givenBy")}`} id={`${idPrefix}-given-by`} name="givenBy" defaultValue={text("givenBy", "patient")}>
          {CONSENT_GIVEN_BY.map((who) => (
            <option key={who} value={who}>
              {CONSENT_GIVEN_BY_LABELS[who]}
            </option>
          ))}
        </NativeSelect>
        <p className={HELP}>Para paciente menor de 18 anos, quem consente é o responsável legal.</p>
      </div>

      <div className={FIELD}>
        <label htmlFor={`${idPrefix}-method`} className={LABEL}>
          Como foi obtido
        </label>
        <NativeSelect key={`method-${resetKey("method")}`} id={`${idPrefix}-method`} name="method" defaultValue={text("method", "")}>
          <option value="">Escolha…</option>
          {CONSENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {CONSENT_METHOD_LABELS[method]}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className={FIELD}>
        <label htmlFor={`${idPrefix}-date`} className={LABEL}>
          Data do consentimento
        </label>
        <Input
          key={`date-${resetKey("occurredOn")}`}
          id={`${idPrefix}-date`}
          name="occurredOn"
          type="date"
          min={CONSENT_DATE_MIN}
          max={today}
          defaultValue={text("occurredOn", today)}
          autoComplete="off"
          aria-describedby={`${idPrefix}-date-help`}
        />
        <p id={`${idPrefix}-date-help`} className={HELP}>
          A data em que o paciente consentiu, que pode ser anterior a hoje (por exemplo, o papel assinado na semana
          passada).
        </p>
      </div>

      <div className={FIELD}>
        <label htmlFor={`${idPrefix}-note`} className={LABEL}>
          Observação (opcional)
        </label>
        <textarea
          key={`note-${resetKey("note")}`}
          id={`${idPrefix}-note`}
          name="note"
          className={TEXTAREA}
          maxLength={CONSENT_NOTE_MAX}
          defaultValue={text("note", "")}
          onChange={(event) => setNoteLength(event.target.value.length)}
          aria-describedby={`${idPrefix}-note-help`}
        />
        <p id={`${idPrefix}-note-help`} className={HELP}>
          Não registre dado de saúde aqui. {noteLength}/{CONSENT_NOTE_MAX}
        </p>
      </div>

      <Button type="submit" className="h-11" disabled={pending}>
        {pending ? "Registrando…" : "Registrar"}
      </Button>
    </form>
  );
}
