import { inArray } from "drizzle-orm";

import type { Tx } from "./client";
import {
  insurances,
  patientPrivate,
  patientProfessionals,
  patients,
  professionals,
} from "./schema";

/**
 * Cenário e leituras dos testes de RLS de pacientes (`patients-rls.test.ts` e
 * `patients-rls-write.test.ts`). Só dados FICTÍCIOS; só `*.test.ts` importam. Fica à parte para os
 * dois arquivos rodarem em paralelo, cada um com o seu cenário.
 */

export type Seed = {
  pA: string; // profissional ligado a ids.professional
  pB: string; // profissional ligado a ids.professional2
  pRemoved: string; // profissional removido
  insuranceId: string;
  p1: string; // só de A
  p2: string; // só de B
  p3: string; // de A e de B
  p4: string; // sem vínculo
  p5: string; // REMOVIDO, de A
  p6: string; // INATIVO, de A
};

let cpfCounter = 0;
/** CPFs fictícios só no formato (o banco confere 11 dígitos; os dígitos verificadores são do app). */
export const nextCpf = () => String(10_000_000_000 + ++cpfCounter + Math.floor(Math.random() * 1_000_000) * 100);

export async function seed(tx: Tx, ids: { professional: string; professional2: string }): Promise<Seed> {
  const [pA] = await tx
    .insert(professionals)
    .values({ fullName: "[teste] Ana Pac", specialty: "physiotherapy", profileId: ids.professional })
    .returning({ id: professionals.id });
  const [pB] = await tx
    .insert(professionals)
    .values({ fullName: "[teste] Bia Pac", specialty: "physiotherapy", profileId: ids.professional2 })
    .returning({ id: professionals.id });
  const [pRemoved] = await tx
    .insert(professionals)
    .values({ fullName: "[teste] Davi Pac", specialty: "dentistry", deletedAt: new Date() })
    .returning({ id: professionals.id });
  const [insurance] = await tx
    .insert(insurances)
    .values({ name: "[teste] Convênio Pac" })
    .returning({ id: insurances.id });

  const rows = await tx
    .insert(patients)
    .values([
      { fullName: "[teste] Paciente Um", birthDate: "1990-05-10", phone: "11912345678" },
      { fullName: "[teste] Paciente Dois", birthDate: "1985-03-02" },
      { fullName: "[teste] Paciente Tres", birthDate: "2001-12-31", email: "tres@teste.invalid" },
      { fullName: "[teste] Paciente Quatro", birthDate: "1970-01-01" },
      { fullName: "[teste] Paciente Cinco", birthDate: "1999-09-09", deletedAt: new Date() },
      { fullName: "[teste] Paciente Seis", birthDate: "1960-06-06", active: false },
    ])
    .returning({ id: patients.id });
  const [p1, p2, p3, p4, p5, p6] = rows.map((r) => r.id) as [string, string, string, string, string, string];

  await tx.insert(patientPrivate).values(
    [p1, p2, p3, p4, p5, p6].map((patientId, i) => ({
      patientId,
      cpf: i === 3 ? null : nextCpf(),
      noCpfReason: i === 3 ? "[teste] Estrangeiro" : null,
      street: "[teste] Rua Fictícia",
      insuranceId: i === 0 ? insurance!.id : null,
      insuranceCard: i === 0 ? "123456" : null,
      adminNotes: "[teste] observação administrativa",
    })),
  );
  await tx.insert(patientProfessionals).values([
    { patientId: p1, professionalId: pA!.id },
    { patientId: p2, professionalId: pB!.id },
    { patientId: p3, professionalId: pA!.id },
    { patientId: p3, professionalId: pB!.id },
    { patientId: p5, professionalId: pA!.id },
    { patientId: p6, professionalId: pA!.id },
  ]);
  return { pA: pA!.id, pB: pB!.id, pRemoved: pRemoved!.id, insuranceId: insurance!.id, p1, p2, p3, p4, p5, p6 };
}

export const sorted = (list: string[]) => [...list].sort();
export const all = (s: Seed) => [s.p1, s.p2, s.p3, s.p4, s.p5, s.p6];
export const seenPatients = async (tx: Tx, s: Seed) =>
  sorted((await tx.select({ id: patients.id }).from(patients).where(inArray(patients.id, all(s)))).map((r) => r.id));
export const seenPrivate = async (tx: Tx, s: Seed) =>
  sorted(
    (await tx.select({ id: patientPrivate.patientId }).from(patientPrivate).where(inArray(patientPrivate.patientId, all(s)))).map(
      (r) => r.id,
    ),
  );
/** Vínculos como "paciente|profissional", para comparar com clareza. */
export const seenLinks = async (tx: Tx, s: Seed) =>
  sorted(
    (await tx.select().from(patientProfessionals).where(inArray(patientProfessionals.patientId, all(s)))).map(
      (r) => `${r.patientId}|${r.professionalId}`,
    ),
  );
export const link = (patientId: string, professionalId: string) => `${patientId}|${professionalId}`;
