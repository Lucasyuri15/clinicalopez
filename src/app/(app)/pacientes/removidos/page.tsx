import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTimeBR } from "@/lib/datetime";
import { formatBirthDate } from "@/lib/patients/labels";
import { requirePageAccess } from "@/server/auth/session";
import { restorePatientAction } from "@/server/patients/actions";
import { listRemovedPatients } from "@/server/patients/queries";

export const metadata: Metadata = { title: "Pacientes removidos" };

export default async function RemovedPatientsPage() {
  // A matriz de acesso restringe esta sub-rota ao admin (`SUBROUTE_ACCESS`): recepção e profissional
  // são mandados de volta ao Dashboard antes de chegar à consulta.
  const user = await requirePageAccess("/pacientes/removidos");
  const removed = await listRemovedPatients({ userId: user.userId });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <Link href="/pacientes" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Pacientes
        </Link>
        <h1 className="mt-1 text-2xl font-semibold md:text-3xl">Pacientes removidos</h1>
        <p className="mt-1 text-muted-foreground">
          Os dados ficam guardados e o CPF continua reservado. Ao reativar, o cadastro volta às listas como estava,
          com o histórico de consentimentos.
        </p>
      </header>

      {removed.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-muted-foreground">Nenhum paciente removido.</CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Pacientes removidos">
          {removed.map((patient) => (
            <li key={patient.id}>
              <Card>
                <CardContent className="flex flex-col gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{patient.fullName}</p>
                    <p className="text-sm text-muted-foreground">
                      Nascimento {formatBirthDate(patient.birthDate)} · removido em{" "}
                      {formatDateTimeBR(patient.deletedAt)}
                    </p>
                  </div>
                  <details className="rounded-lg border border-border p-3">
                    <summary className="cursor-pointer text-sm font-medium">Reativar</summary>
                    <div className="mt-3 flex flex-col gap-3 text-sm">
                      <p className="text-muted-foreground">
                        O paciente volta às listas de admin e recepção e aos profissionais vinculados a ele.
                      </p>
                      <form action={restorePatientAction}>
                        <input type="hidden" name="id" value={patient.id} />
                        <Button type="submit" className="h-11 md:h-8">
                          Confirmar reativação de {patient.fullName}
                        </Button>
                      </form>
                    </div>
                  </details>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
