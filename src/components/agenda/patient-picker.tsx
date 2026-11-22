"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateBR, zonedToUtc } from "@/lib/datetime";
import { searchPatients, type PatientSearchState } from "@/server/patients/actions";

type Found = NonNullable<PatientSearchState>["items"][number];

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;

const birth = (value: string) => formatDateBR(zonedToUtc(value, "12:00"));

/**
 * Escolha do paciente no formulário de agendar. Busca pela ação `searchPatients` (POST: o termo
 * nunca vai para a URL), sem `<form>` aninhado e sem `name` no campo de busca (o texto digitado não
 * é enviado com o agendamento). O escolhido vai num `<input type="hidden" name="patientId">`. O
 * estado mora no React: o reset do formulário depois de uma ação não apaga a escolha.
 */
export function PatientPicker({ id }: { id: string }) {
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<Found[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searched, setSearched] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const request = useRef(0);

  useEffect(() => {
    const text = term.trim();
    if (text.length < MIN_CHARS) {
      request.current += 1; // descarta uma resposta que ainda esteja a caminho
      return;
    }
    const mine = ++request.current;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const data = new FormData();
        data.set("q", text);
        try {
          const response = await searchPatients(undefined, data);
          if (mine !== request.current) return; // chegou depois de uma busca mais nova
          setResults((response?.items ?? []).filter((patient) => patient.active));
          setTruncated(response?.truncated ?? false);
          setFailed(false);
          setSearched(true);
        } catch {
          // Uma falha da busca não pode derrubar a agenda (uma exceção na transição iria para o
          // limite de erro da página): avisa e deixa tentar de novo. Nada do erro é mostrado ou logado.
          if (mine !== request.current) return;
          setResults([]);
          setFailed(true);
          setSearched(false);
        }
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const showResults = term.trim().length >= MIN_CHARS && searched;

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <input type="hidden" name="patientId" value={selected.id} />
        <span className="min-w-0 break-words text-sm font-medium" data-testid="selected-patient">
          {selected.name}
        </span>
        <Button type="button" variant="outline" size="sm" className="h-10 md:h-7" onClick={() => setSelected(null)}>
          Trocar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="patientId" value="" />
      <Input
        id={id}
        type="search"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setSearched(false); // a lista antiga some enquanto a nova busca não chega
          setFailed(false);
        }}
        onKeyDown={(event) => {
          // Enter num campo de busca dentro do formulário enviaria o AGENDAMENTO sem paciente.
          if (event.key === "Enter") event.preventDefault();
        }}
        placeholder="Nome (ou 3 primeiros dígitos do CPF)"
        autoComplete="off"
        aria-describedby={`${id}-help`}
      />
      <p id={`${id}-help`} className="text-xs text-muted-foreground" aria-live="polite">
        {failed
          ? "Não foi possível buscar. Tente de novo."
          : pending
            ? "Buscando…"
            : term.trim().length < MIN_CHARS
              ? `Digite pelo menos ${MIN_CHARS} letras para buscar.`
              : showResults && results.length === 0
                ? "Nenhum paciente ativo encontrado."
                : showResults
                  ? `${results.length} ${results.length === 1 ? "paciente encontrado" : "pacientes encontrados"}${truncated ? " (refine a busca para ver mais)" : ""}.`
                  : " "}
      </p>
      {showResults && results.length > 0 ? (
        <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-1">
          {results.map((patient) => (
            <li key={patient.id}>
              <button
                type="button"
                className="flex min-h-11 w-full flex-col items-start justify-center rounded-md px-3 py-1 text-left text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={() => {
                  setSelected({ id: patient.id, name: patient.fullName });
                  setTerm("");
                  setResults([]);
                  setSearched(false);
                }}
              >
                <span className="font-medium">{patient.fullName}</span>
                <span className="text-xs text-muted-foreground">Nascimento: {birth(patient.birthDate)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
