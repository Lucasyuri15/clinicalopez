import type { Specialty } from "@/lib/catalog/labels";

/**
 * Conselho profissional de cada especialidade. É DERIVADO da especialidade (só um rótulo para
 * mostrar ao lado do registro), por isso não é guardado no banco.
 */
const COUNCILS: Record<Specialty, string> = {
  physiotherapy: "CREFITO",
  dentistry: "CRO",
  psychology: "CRP",
};

export function councilLabel(specialty: Specialty): string {
  return COUNCILS[specialty];
}

/**
 * "CREFITO 12345-F" para mostrar ao lado do nome. Se quem cadastrou já digitou o conselho no
 * campo (ex.: "CREFITO 12345", "crefito-3/12345"), não o repete. `null` quando não há registro.
 */
export function formatRegistration(specialty: Specialty, registration: string | null): string | null {
  if (!registration) return null;
  const council = councilLabel(specialty);
  // O conselho só conta se vier como PALAVRA inteira no começo (CROMO não é CRO).
  const alreadyThere = new RegExp(`^${council}(?![A-Za-zÀ-ÿ])`, "i").test(registration);
  return alreadyThere ? registration : `${council} ${registration}`;
}
