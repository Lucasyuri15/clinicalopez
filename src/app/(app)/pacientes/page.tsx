import type { Metadata } from "next";

import { PatientDirectory } from "@/components/patients/patient-directory";
import { todayBR } from "@/lib/datetime";
import { requirePageAccess } from "@/server/auth/session";
import { listInsurances } from "@/server/catalog/queries";
import { DEFAULT_LIST_LIMIT, listPatients } from "@/server/patients/queries";
import { listProfessionals } from "@/server/professionals/queries";

export const metadata: Metadata = { title: "Pacientes" };

export default async function PacientesPage() {
  const user = await requirePageAccess("/pacientes");
  const actor = { userId: user.userId };
  // Admin e recepção cadastram; o profissional enxerga SÓ os pacientes vinculados a ele (a RLS
  // decide, não esta tela) e nunca CPF, endereço nem convênio (nem chegam a esta página).
  const canEdit = user.role !== "professional";
  const today = todayBR();

  const [initial, professionals, insurances] = await Promise.all([
    listPatients(actor),
    canEdit ? listProfessionals(actor) : [],
    canEdit ? listInsurances(actor) : [],
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold md:text-3xl">{canEdit ? "Pacientes" : "Meus pacientes"}</h1>
          <p className="mt-1 text-muted-foreground">
            {canEdit
              ? "Cadastro dos pacientes da clínica."
              : "Os pacientes vinculados a você. Os dados administrativos ficam com a recepção."}
          </p>
        </div>
      </header>

      <PatientDirectory
        initial={initial}
        canEdit={canEdit}
        today={today}
        limit={DEFAULT_LIST_LIMIT}
        creation={
          canEdit
            ? {
                // Só o que a gaveta usa (não o cadastro inteiro do profissional: telefone, e-mail, login...).
                professionals: professionals
                  .filter((p) => p.active)
                  .map(({ id, fullName, specialty, active }) => ({ id, fullName, specialty, active })),
                insurances: insurances.filter((i) => i.active),
              }
            : undefined
        }
      />
    </div>
  );
}
