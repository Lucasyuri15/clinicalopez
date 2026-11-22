import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { agendaHref } from "@/lib/appointments/href";
import type { AgendaFilters } from "@/lib/appointments/schemas";
import { SPECIALTIES, specialtyLabel } from "@/lib/catalog/labels";
import { stepDate } from "@/lib/schedule/calendar";

type ProfessionalOption = {
  id: string;
  fullName: string;
  specialty: (typeof SPECIALTIES)[number];
  /** Inativo ainda aparece (o histórico dele continua na agenda), com o aviso no nome. */
  active: boolean;
};

type Props = {
  filters: AgendaFilters;
  today: string;
  /** O filtro de profissional só existe para a equipe (o profissional vê só o próprio pela RLS). */
  professionals: ProfessionalOption[] | null;
  /** Título do período mostrado (dia ou semana). */
  heading: string;
  /** Ação à direita (o botão Agendar, só para a equipe). */
  children?: ReactNode;
};

const NAV = buttonVariants({ variant: "outline", size: "default" });
const NAV_CLASS = `${NAV} h-11 min-w-11 px-3 md:h-8 md:min-w-8`;
const TOGGLE_BASE = "inline-flex h-11 items-center justify-center px-4 text-sm font-medium md:h-8 md:px-3";

/**
 * Navegação e filtros da agenda. Tudo é link ou `<form method="get">`: o estado fica na URL
 * (visão, data, profissional, especialidade) e nenhum dado de paciente passa por ela.
 */
export function AgendaToolbar({ filters, today, professionals, heading, children }: Props) {
  const { view } = filters;
  const visible = professionals?.filter((p) => !filters.specialty || p.specialty === filters.specialty) ?? null;

  return (
    <section aria-label="Navegação da agenda" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={agendaHref(filters, { date: stepDate(filters.date, view, -1) })}
          className={NAV_CLASS}
          aria-label={view === "week" ? "Semana anterior" : "Dia anterior"}
        >
          <ChevronLeftIcon aria-hidden="true" />
        </Link>
        <Link href={agendaHref(filters, { date: today })} className={NAV_CLASS}>
          Hoje
        </Link>
        <Link
          href={agendaHref(filters, { date: stepDate(filters.date, view, 1) })}
          className={NAV_CLASS}
          aria-label={view === "week" ? "Próxima semana" : "Próximo dia"}
        >
          <ChevronRightIcon aria-hidden="true" />
        </Link>
        <h2 className="min-w-0 flex-1 text-lg font-semibold md:text-xl" aria-live="polite">
          {heading}
        </h2>
        {children}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <nav aria-label="Visão" className="inline-flex overflow-hidden rounded-lg border border-border">
          {(["day", "week"] as const).map((option) => (
            <Link
              key={option}
              href={agendaHref(filters, { view: option })}
              aria-current={view === option ? "page" : undefined}
              className={`${TOGGLE_BASE} ${view === option ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              {option === "day" ? "Dia" : "Semana"}
            </Link>
          ))}
        </nav>

        {/* O profissional (papel) só vê os próprios atendimentos: filtrar por especialidade não serve. */}
        {professionals === null ? null : (
        <form method="get" action="/agenda" className="flex flex-1 flex-wrap items-end gap-3">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={filters.date} />
          <div className="flex min-w-40 flex-1 flex-col gap-1">
            <label htmlFor="agenda-specialty" className="text-sm font-medium">
              Especialidade
            </label>
            <NativeSelect
              id="agenda-specialty"
              name="specialty"
              defaultValue={filters.specialty ?? ""}
              key={`specialty-${filters.specialty ?? "todas"}`}
            >
              <option value="">Todas</option>
              {SPECIALTIES.map((specialty) => (
                <option key={specialty} value={specialty}>
                  {specialtyLabel(specialty)}
                </option>
              ))}
            </NativeSelect>
          </div>
          {visible ? (
            <div className="flex min-w-40 flex-1 flex-col gap-1">
              <label htmlFor="agenda-professional" className="text-sm font-medium">
                Profissional
              </label>
              <NativeSelect
                id="agenda-professional"
                name="professional"
                defaultValue={filters.professional ?? ""}
                key={`professional-${filters.professional ?? "todos"}-${filters.specialty ?? "todas"}`}
              >
                {view === "week" ? null : <option value="">Todos</option>}
                {visible.map((professional) => (
                  <option key={professional.id} value={professional.id}>
                    {professional.fullName} ({specialtyLabel(professional.specialty)}){professional.active ? "" : " — inativo"}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <button type="submit" className={`${buttonVariants({ variant: "secondary" })} h-11 px-4 md:h-8`}>
            Filtrar
          </button>
        </form>
        )}
      </div>
    </section>
  );
}
