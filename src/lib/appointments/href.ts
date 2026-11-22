import type { AgendaFilters } from "./schemas";

/**
 * Endereço da agenda com os filtros (`/agenda?view=...&date=...`). A visão e a data vão sempre;
 * profissional e especialidade só quando existem. `overrides` troca só o que vier (com `null` o
 * filtro é limpo). NUNCA recebe dado de paciente: a URL é só de navegação.
 */
export function agendaHref(filters: AgendaFilters, overrides: Partial<AgendaFilters> = {}): string {
  const merged: AgendaFilters = { ...filters, ...overrides };
  const params = new URLSearchParams({ view: merged.view, date: merged.date });
  if (merged.professional) params.set("professional", merged.professional);
  if (merged.specialty) params.set("specialty", merged.specialty);
  return `/agenda?${params.toString()}`;
}
