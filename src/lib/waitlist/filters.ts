import { z } from "zod";

import { SPECIALTIES, type Specialty } from "@/lib/catalog/labels";

/**
 * Filtros da tela da lista de espera, na URL. Qualquer valor inválido volta ao padrão (abertas, sem
 * filtro); parâmetro repetido vale o primeiro. Só entram na URL ids de profissional e a especialidade:
 * NUNCA dado de paciente nem a nota.
 */
export type WaitlistView = "open" | "closed";

export type WaitlistUrlFilters = {
  view: WaitlistView;
  specialty: Specialty | null;
  professional: string | null;
};

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? (value[0] ?? "") : (value ?? ""));

export function parseWaitlistFilters(params: Record<string, string | string[] | undefined>): WaitlistUrlFilters {
  const view: WaitlistView = first(params.aba).trim() === "encerradas" ? "closed" : "open";
  const rawSpecialty = first(params.especialidade).trim();
  const specialty = (SPECIALTIES as readonly string[]).includes(rawSpecialty) ? (rawSpecialty as Specialty) : null;
  const rawProfessional = first(params.profissional).trim().toLowerCase();
  const professional = z.guid().safeParse(rawProfessional).success ? rawProfessional : null;
  return { view, specialty, professional };
}

/** O endereço da tela para um conjunto de filtros (só o que foge do padrão). */
export function waitlistHref(filters: WaitlistUrlFilters): string {
  const query = new URLSearchParams();
  if (filters.view === "closed") query.set("aba", "encerradas");
  if (filters.specialty) query.set("especialidade", filters.specialty);
  if (filters.professional) query.set("profissional", filters.professional);
  const text = query.toString();
  return text === "" ? "/lista-espera" : `/lista-espera?${text}`;
}
