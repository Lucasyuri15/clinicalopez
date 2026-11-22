import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActiveToggle } from "@/components/catalog/active-toggle";
import { StatusBadge } from "@/components/catalog/status-badge";
import { ConsentCard } from "@/components/patients/consent-card";
import { NoConsentBadge } from "@/components/patients/consent-badge";
import { PatientSheet, type EditablePatient } from "@/components/patients/patient-sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { specialtyLabel } from "@/lib/catalog/labels";
import { todayBR } from "@/lib/datetime";
import { ageInYears } from "@/lib/patients/age";
import { currentConsents, lacksDataConsent } from "@/lib/patients/consents";
import { formatCpf } from "@/lib/patients/cpf";
import { formatAge, formatBirthDate } from "@/lib/patients/labels";
import { formatPhone } from "@/lib/phone";
import { requirePageAccess } from "@/server/auth/session";
import { listInsurances } from "@/server/catalog/queries";
import { removePatientAction, setPatientActiveAction } from "@/server/patients/actions";
import { listConsents } from "@/server/patients/consent-queries";
import { getPatient, type PatientPrivateData } from "@/server/patients/queries";
import { listProfessionals } from "@/server/professionals/queries";

export const metadata: Metadata = { title: "Paciente" };

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function addressLines(data: PatientPrivateData): string | null {
  const street = [data.street, data.number].filter(Boolean).join(", ");
  const place = [data.district, [data.city, data.state].filter(Boolean).join(" - ")].filter(Boolean).join(" · ");
  const cep = data.cep ? `CEP ${data.cep.slice(0, 5)}-${data.cep.slice(5)}` : "";
  const parts = [street, data.complement, place, cep].filter((part) => part && part !== "");
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default async function PatientPage(props: PageProps<"/pacientes/[id]">) {
  const user = await requirePageAccess("/pacientes/[id]");
  const { id } = await props.params;
  const actor = { userId: user.userId };
  const isStaff = user.role !== "professional";
  const isAdmin = user.role === "admin";
  const today = todayBR();

  // `null` para id inexistente, removido ou que a RLS esconde (o profissional não abre paciente
  // que não é dele). Para o profissional, `private` vem SEMPRE nulo: a RLS não devolve a linha.
  const patient = await getPatient(actor, id, { staff: isStaff });
  if (!patient) notFound();

  // O histórico de consentimentos é só de admin e recepção: o profissional nem consulta (a RLS não
  // devolveria linha) e nunca recebe o aviso.
  const [professionals, insurances, consents] = isStaff
    ? await Promise.all([listProfessionals(actor), listInsurances(actor), listConsents(actor, patient.id)])
    : [[], [], []];
  const missingDataConsent = isStaff && lacksDataConsent(currentConsents(consents));
  const data = isStaff ? patient.private : null;
  const insuranceName = data?.insuranceId ? insurances.find((i) => i.id === data.insuranceId)?.name : undefined;
  const professionalById = new Map(professionals.map((p) => [p.id, p]));

  const editable: EditablePatient | undefined = isStaff
    ? {
        id: patient.id,
        fullName: patient.fullName,
        birthDate: patient.birthDate,
        phone: patient.phone,
        email: patient.email,
        cpf: data?.cpf ?? null,
        noCpfReason: data?.noCpfReason ?? null,
        cep: data?.cep ?? null,
        street: data?.street ?? null,
        number: data?.number ?? null,
        complement: data?.complement ?? null,
        district: data?.district ?? null,
        city: data?.city ?? null,
        state: data?.state ?? null,
        insuranceId: data?.insuranceId ?? null,
        insuranceCard: data?.insuranceCard ?? null,
        guardianName: data?.guardianName ?? null,
        guardianRelationship: data?.guardianRelationship ?? null,
        guardianPhone: data?.guardianPhone ?? null,
        guardianCpf: data?.guardianCpf ?? null,
        adminNotes: data?.adminNotes ?? null,
        professionalIds: patient.professionalIds,
      }
    : undefined;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <Link href="/pacientes" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← {isStaff ? "Pacientes" : "Meus pacientes"}
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold md:text-3xl">{patient.fullName}</h1>
            <StatusBadge active={patient.active} />
            {missingDataConsent ? <NoConsentBadge /> : null}
          </div>
          {isStaff && editable ? (
            <div className="flex items-center gap-2">
              <PatientSheet
                patient={editable}
                professionals={professionals
                  .filter((p) => p.active || patient.professionalIds.includes(p.id))
                  .map(({ id, fullName, specialty, active }) => ({ id, fullName, specialty, active }))}
                insurances={insurances.filter((i) => i.active || i.id === data?.insuranceId)}
                today={today}
              />
              <ActiveToggle
                action={setPatientActiveAction}
                id={patient.id}
                active={patient.active}
                name={patient.fullName}
              />
            </div>
          ) : null}
        </div>
      </header>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <h2 className="font-medium">Dados pessoais</h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Field label="Nascimento">
              {formatBirthDate(patient.birthDate)} · {formatAge(ageInYears(patient.birthDate, today))}
            </Field>
            <Field label="Telefone / WhatsApp">{patient.phone ? formatPhone(patient.phone) : "Não informado"}</Field>
            <Field label="E-mail">{patient.email ?? "Não informado"}</Field>
          </dl>
        </CardContent>
      </Card>

      {isStaff ? (
        <>
          {data === null ? (
            <Card>
              <CardContent className="py-4 text-sm text-muted-foreground">
                Este paciente ainda não tem dados administrativos (CPF, endereço, convênio). Use “Editar” para
                completar.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardContent className="flex flex-col gap-3">
                  <h2 className="font-medium">Documento e convênio</h2>
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                    <Field label="CPF">
                      {data.cpf ? formatCpf(data.cpf) : `Sem CPF. Motivo: ${data.noCpfReason ?? "não informado"}`}
                    </Field>
                    <Field label="Convênio">
                      {data.insuranceId ? (insuranceName ?? "Convênio removido") : "Particular"}
                      {data.insuranceCard ? ` · carteirinha ${data.insuranceCard}` : ""}
                    </Field>
                    <Field label="Endereço" wide>
                      {addressLines(data) ?? "Não informado"}
                    </Field>
                  </dl>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="flex flex-col gap-3">
                  <h2 className="font-medium">Responsável legal</h2>
                  {data.guardianName ? (
                    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                      <Field label="Nome">{data.guardianName}</Field>
                      <Field label="Parentesco">{data.guardianRelationship ?? "Não informado"}</Field>
                      <Field label="Telefone">
                        {data.guardianPhone ? formatPhone(data.guardianPhone) : "Não informado"}
                      </Field>
                      <Field label="CPF">{data.guardianCpf ? formatCpf(data.guardianCpf) : "Não informado"}</Field>
                    </dl>
                  ) : (
                    <p className="text-sm text-muted-foreground">Sem responsável cadastrado.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="flex flex-col gap-2">
                  <h2 className="font-medium">Observações administrativas</h2>
                  <p className="whitespace-pre-wrap break-words text-sm">{data.adminNotes ?? "Nenhuma observação."}</p>
                </CardContent>
              </Card>
            </>
          )}

          <ConsentCard patientId={patient.id} patientName={patient.fullName} today={today} events={consents} />

          <Card>
            <CardContent className="flex flex-col gap-2">
              <h2 className="font-medium">Profissionais que atendem</h2>
              {patient.professionalIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum profissional vinculado: nenhum profissional vê este paciente ainda.
                </p>
              ) : (
                <ul className="text-sm">
                  {patient.professionalIds.map((professionalId) => {
                    const professional = professionalById.get(professionalId);
                    return (
                      <li key={professionalId}>
                        {professional
                          ? `${professional.fullName} · ${specialtyLabel(professional.specialty)}${professional.active ? "" : " (inativo)"}`
                          : "Profissional"}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {isAdmin ? (
            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Remover paciente</summary>
              <div className="mt-3 flex flex-col gap-3 text-sm">
                <p className="text-muted-foreground">
                  O cadastro sai das listas para todos, mas os dados ficam guardados (não é exclusão definitiva) e o
                  CPF continua reservado.
                </p>
                <form action={removePatientAction}>
                  <input type="hidden" name="id" value={patient.id} />
                  <Button type="submit" variant="destructive" className="h-11 md:h-8">
                    Confirmar remoção de {patient.fullName}
                  </Button>
                </form>
              </div>
            </details>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
