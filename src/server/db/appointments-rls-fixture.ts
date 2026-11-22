import { randomUUID } from "node:crypto";

import type { Tx } from "./client";
import {
  appointmentPrices,
  appointments,
  patientProfessionals,
  patients,
  professionals,
  services,
} from "./schema";

/**
 * Cenário dos testes de RLS da agenda (`appointments-rls.test.ts` e `appointments-rls-write.test.ts`).
 * Só dados FICTÍCIOS; só `*.test.ts` importam. Cada arquivo chama `seedAgenda` com um `label` e o
 * nome de cada profissional/serviço leva um sufixo ALEATÓRIO: `professionals` e `services` têm
 * índice único por (especialidade, nome) e cada arquivo de RLS mantém a transação aberta o arquivo
 * inteiro, então um nome repetido faria o arquivo seguinte esperar o anterior terminar.
 *
 * Atendimentos semeados (pelo dono do banco, com `created_at` no PASSADO de propósito: o valor só
 * pode ser inserido na mesma transação do atendimento, `created_at = now()`):
 *  a1  pA + p1  agendada   2031-06-02 13:00–13:50Z      (valor 15000)
 *  a2  pB + p2  agendada   2031-06-02 13:00–13:50Z      (valor 9000)
 *  a3  pA + p3  confirmada 2031-06-02 14:00–14:50Z      (valor 12000)
 *  a5  pA + p2  CANCELADA  2031-06-02 13:00–13:50Z      (mesmo horário de a1: cancelada libera)
 *  a6  pA + p4  agendada   2031-06-02 15:00–15:50Z      (p4 NÃO é vinculado a pA)
 *  closed.<status>  pA + p1, no PASSADO (2026-01-05 08:00, 09:00, 10:00, 11:00, 12:00Z), um por status
 */
export const FUTURE_DAY = "2031-06-02";
export const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00.000Z`);

export type AgendaSeed = {
  professionalA: string; // login = ids.professional
  professionalB: string; // login = ids.professional2
  serviceId: string; // fisioterapia, ativo
  dentalServiceId: string; // odontologia (especialidade diferente)
  inactiveServiceId: string; // fisioterapia, inativo
  p1: string; // vinculado a A
  p2: string; // vinculado a B
  p3: string; // vinculado a A
  p4: string; // sem vínculo
  pRemoved: string; // paciente REMOVIDO
  a1: string;
  a2: string;
  a3: string;
  a5: string;
  a6: string;
  closed: { scheduled: string; confirmed: string; done: string; no_show: string; cancelled: string };
  all: string[]; // todos os ids de atendimento semeados
};

export async function seedAgenda(
  tx: Tx,
  ids: { admin: string; professional: string; professional2: string },
  label: string,
): Promise<AgendaSeed> {
  const tag = `${label} ${randomUUID().slice(0, 8)}`;
  const [pA] = await tx
    .insert(professionals)
    .values({ fullName: `[teste] Ana ${tag}`, specialty: "physiotherapy", profileId: ids.professional })
    .returning({ id: professionals.id });
  const [pB] = await tx
    .insert(professionals)
    .values({ fullName: `[teste] Bia ${tag}`, specialty: "physiotherapy", profileId: ids.professional2 })
    .returning({ id: professionals.id });
  const [svc] = await tx
    .insert(services)
    .values({ name: `[teste] Sessão ${tag}`, specialty: "physiotherapy", durationMinutes: 50 })
    .returning({ id: services.id });
  const [dental] = await tx
    .insert(services)
    .values({ name: `[teste] Limpeza ${tag}`, specialty: "dentistry", durationMinutes: 40 })
    .returning({ id: services.id });
  const [inactive] = await tx
    .insert(services)
    .values({ name: `[teste] Antiga ${tag}`, specialty: "physiotherapy", durationMinutes: 30, active: false })
    .returning({ id: services.id });

  const rows = await tx
    .insert(patients)
    .values([
      { fullName: "[teste] Paciente Um", birthDate: "1990-05-10" },
      { fullName: "[teste] Paciente Dois", birthDate: "1985-03-02" },
      { fullName: "[teste] Paciente Tres", birthDate: "2001-12-31" },
      { fullName: "[teste] Paciente Quatro", birthDate: "1970-01-01" },
      { fullName: "[teste] Paciente Removido", birthDate: "1999-09-09", deletedAt: new Date() },
    ])
    .returning({ id: patients.id });
  const [p1, p2, p3, p4, pRemoved] = rows.map((row) => row.id) as [string, string, string, string, string];
  await tx.insert(patientProfessionals).values([
    { patientId: p1, professionalId: pA!.id },
    { patientId: p3, professionalId: pA!.id },
    { patientId: p2, professionalId: pB!.id },
  ]);

  const base = {
    serviceId: svc!.id,
    specialty: "physiotherapy" as const,
    createdBy: ids.admin,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
  const insertOne = async (values: Omit<typeof appointments.$inferInsert, keyof typeof base | "serviceId">) => {
    const [row] = await tx
      .insert(appointments)
      .values({ ...base, ...values })
      .returning({ id: appointments.id });
    return row!.id;
  };
  const slot = (day: string, from: string, to: string) => ({ startsAt: at(day, from), endsAt: at(day, to) });

  const a1 = await insertOne({ professionalId: pA!.id, patientId: p1, ...slot(FUTURE_DAY, "13:00", "13:50") });
  const a2 = await insertOne({ professionalId: pB!.id, patientId: p2, ...slot(FUTURE_DAY, "13:00", "13:50") });
  const a3 = await insertOne({
    professionalId: pA!.id,
    patientId: p3,
    status: "confirmed",
    ...slot(FUTURE_DAY, "14:00", "14:50"),
  });
  const a5 = await insertOne({
    professionalId: pA!.id,
    patientId: p2,
    status: "cancelled",
    cancelReason: "[teste] cancelado",
    ...slot(FUTURE_DAY, "13:00", "13:50"),
  });
  const a6 = await insertOne({ professionalId: pA!.id, patientId: p4, ...slot(FUTURE_DAY, "15:00", "15:50") });

  const closedDay = "2026-01-05";
  const closed = {
    scheduled: await insertOne({ professionalId: pA!.id, patientId: p1, ...slot(closedDay, "08:00", "08:50") }),
    confirmed: await insertOne({
      professionalId: pA!.id,
      patientId: p1,
      status: "confirmed",
      ...slot(closedDay, "09:00", "09:50"),
    }),
    done: await insertOne({
      professionalId: pA!.id,
      patientId: p1,
      status: "done",
      ...slot(closedDay, "10:00", "10:50"),
    }),
    no_show: await insertOne({
      professionalId: pA!.id,
      patientId: p1,
      status: "no_show",
      ...slot(closedDay, "11:00", "11:50"),
    }),
    cancelled: await insertOne({
      professionalId: pA!.id,
      patientId: p1,
      status: "cancelled",
      cancelReason: "[teste] cancelado",
      ...slot(closedDay, "12:00", "12:50"),
    }),
  };

  await tx.insert(appointmentPrices).values([
    { appointmentId: a1, priceCents: 15_000, createdAt: base.createdAt },
    { appointmentId: a2, priceCents: 9_000, createdAt: base.createdAt },
    { appointmentId: a3, priceCents: 12_000, createdAt: base.createdAt },
  ]);

  return {
    professionalA: pA!.id,
    professionalB: pB!.id,
    serviceId: svc!.id,
    dentalServiceId: dental!.id,
    inactiveServiceId: inactive!.id,
    p1,
    p2,
    p3,
    p4,
    pRemoved,
    a1,
    a2,
    a3,
    a5,
    a6,
    closed,
    all: [a1, a2, a3, a5, a6, ...Object.values(closed)],
  };
}
