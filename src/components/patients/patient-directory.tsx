"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";

import { StatusBadge } from "@/components/catalog/status-badge";
import { PatientSheet, type SheetInsurance, type SheetProfessional } from "@/components/patients/patient-sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ageInYears } from "@/lib/patients/age";
import { formatAge, formatBirthDate } from "@/lib/patients/labels";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { searchPatients, type PatientSearchState } from "@/server/patients/actions";
import type { PatientListItem } from "@/server/patients/queries";

const SEARCH_MAX = 100;

type Props = {
  /** A lista padrão, já consultada no servidor (sem busca). */
  initial: { items: PatientListItem[]; truncated: boolean };
  /** Admin e recepção buscam por nome ou CPF; o profissional, só por nome. */
  canEdit: boolean;
  /** Hoje em Brasília ("AAAA-MM-DD"), para a idade. */
  today: string;
  limit: number;
  /** Só para admin e recepção: o botão "Novo paciente" fica aqui para a busca recomeçar depois de salvar. */
  creation?: { professionals: SheetProfessional[]; insurances: SheetInsurance[] };
};

/**
 * Lista de pacientes com busca. A busca é uma Server Action (POST): o termo, que pode ser um CPF
 * ou um nome, NÃO vai para a URL (histórico do navegador, logs de acesso). Só o clínico-básico
 * chega aqui: CPF, endereço e convênio nunca saem do servidor para esta lista.
 */
export function PatientDirectory({ initial, canEdit, today, limit, creation }: Props) {
  const [state, dispatch, pending] = useActionState<PatientSearchState, FormData>(searchPatients, undefined);
  const term = state?.term ?? "";
  const { items, truncated } = state ?? initial;
  // Depois de cadastrar, a busca recomeça (e traz a lista fresca): um resultado velho esconderia o novo paciente.
  const restart = () => startTransition(() => dispatch(new FormData()));

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
      <form action={dispatch} role="search" className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor="patient-search" className="text-sm font-medium">
            Buscar paciente
          </label>
          {/* `key`: o React limpa o formulário depois da ação; remontar com o termo enviado o mantém no campo. */}
          <Input
            key={term}
            id="patient-search"
            name="q"
            type="search"
            defaultValue={term}
            maxLength={SEARCH_MAX}
            autoComplete="off"
            placeholder={canEdit ? "Nome ou CPF" : "Nome"}
          />
        </div>
        <Button type="submit" className="h-11" disabled={pending}>
          Buscar
        </Button>
        {term !== "" ? (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={restart}
          >
            Limpar
          </Button>
        ) : null}
      </form>
      {creation ? (
        <PatientSheet
          professionals={creation.professionals}
          insurances={creation.insurances}
          today={today}
          onSaved={restart}
        />
      ) : null}
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-muted-foreground">
            {term !== ""
              ? "Nenhum paciente encontrado para essa busca."
              : canEdit
                ? "Nenhum paciente cadastrado ainda. Use “Novo paciente” para começar."
                : "Nenhum paciente vinculado a você ainda. Fale com a recepção."}
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="flex flex-col gap-3" aria-label="Pacientes">
            {items.map((patient) => (
              <li key={patient.id}>
                <Card className={patient.active ? undefined : "opacity-80"}>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{patient.fullName}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatBirthDate(patient.birthDate)} · {formatAge(ageInYears(patient.birthDate, today))}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge active={patient.active} />
                        <Link
                          href={`/pacientes/${patient.id}`}
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 md:h-7")}
                          aria-label={`Abrir cadastro de ${patient.fullName}`}
                        >
                          Abrir
                        </Link>
                      </div>
                    </div>
                    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Telefone</dt>
                        <dd>{patient.phone ? formatPhone(patient.phone) : "Não informado"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">E-mail</dt>
                        <dd className="break-all">{patient.email ?? "Não informado"}</dd>
                      </div>
                    </dl>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
          {truncated ? (
            <p className="text-sm text-muted-foreground" role="status">
              Mostrando os primeiros {limit} pacientes. Refine a busca para ver os demais.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
