/**
 * Especialidades da clínica. Mesma lista do enum `specialty` do banco (`src/server/db/schema.ts`,
 * conferida por teste): duplicada de propósito para que o código de tela não importe o schema
 * do Drizzle.
 */
export const SPECIALTIES = ["physiotherapy", "dentistry", "psychology"] as const;

export type Specialty = (typeof SPECIALTIES)[number];

const LABELS: Record<Specialty, string> = {
  physiotherapy: "Fisioterapia",
  dentistry: "Odontologia",
  psychology: "Psicologia",
};

export function specialtyLabel(specialty: Specialty): string {
  return LABELS[specialty];
}
