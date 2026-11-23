import { randomUUID } from "node:crypto";

import { type AgendaSeed, at, seedAgenda } from "./appointments-rls-fixture";
import type { Tx } from "./client";
import { appointments, professionals, waitlistEntries } from "./schema";

/**
 * Cenário dos testes de RLS da lista de espera (`waitlist-rls.test.ts` e `waitlist-rls-write.test.ts`).
 * Só dados FICTÍCIOS; só `*.test.ts` importam. Parte do cenário da agenda (`seedAgenda`) e acrescenta,
 * pelo dono do banco (com `created_at` no PASSADO de propósito):
 *  entryA              WAITING   p1 + serviço + pA, segundas e quartas, 14:00–18:00, com nota
 *  entryB              WAITING   p2 + serviço, qualquer profissional, qualquer dia e horário
 *  entryRemovedPatient WAITING   pRemoved (paciente REMOVIDO) + serviço: a recepção não a enxerga
 *  entryGone           WAITING   p3 + serviço + profissional REMOVIDO: a recepção não a enxerga
 *  entryFulfilled      FULFILLED p1 + serviço, atendida pelo atendimento a1 (p1 + pA + serviço)
 *  entryRemoved        REMOVED   p4 + serviço
 * Atendimentos de p1 para atender entryA/entryFulfilled-like (2031-06-04, livres de conflito):
 *  apFresh      p1 + pA + serviço, 09:00, criado DEPOIS das esperas: o único que serve para atender entryA
 *  apOtherPro   p1 + pB + serviço, 10:00: serve ao paciente e ao serviço, mas é de OUTRO profissional
 *  apStale      p1 + pA + serviço, 11:00, criado ANTES das esperas: não pode atender uma espera mais nova
 * Esperas abertas já ocupadas (índice único): (p1, serviço, pA), (p2, serviço, qualquer),
 * (pRemoved, serviço, qualquer), (p3, serviço, removido). Livres para os testes: p3 e p4.
 */
export type WaitlistSeed = AgendaSeed & {
  professionalGone: string;
  entryA: string;
  entryB: string;
  entryRemovedPatient: string;
  entryGone: string;
  entryFulfilled: string;
  entryRemoved: string;
  apFresh: string;
  apOtherPro: string;
  apStale: string;
  allEntries: string[];
  /** O que a recepção enxerga (paciente e profissional não removidos). */
  receptionEntries: string[];
};

const PAST = new Date("2026-01-01T00:00:00Z");
const CLOSED_AT = new Date("2026-01-02T00:00:00Z");

export async function seedWaitlist(
  tx: Tx,
  ids: { admin: string; professional: string; professional2: string },
  label: string,
): Promise<WaitlistSeed> {
  const base = await seedAgenda(tx, ids, label);
  const [gone] = await tx
    .insert(professionals)
    .values({
      fullName: `[teste] Removida ${label} ${randomUUID().slice(0, 8)}`,
      specialty: "physiotherapy",
      deletedAt: new Date(),
    })
    .returning({ id: professionals.id });

  const common = { serviceId: base.serviceId, specialty: "physiotherapy" as const, createdBy: ids.admin, createdAt: PAST };
  const insertOne = async (values: Omit<typeof waitlistEntries.$inferInsert, keyof typeof common | "serviceId">) => {
    const [row] = await tx
      .insert(waitlistEntries)
      .values({ ...common, ...values })
      .returning({ id: waitlistEntries.id });
    return row!.id;
  };

  const entryA = await insertOne({
    patientId: base.p1,
    professionalId: base.professionalA,
    weekdays: [1, 3],
    startMinute: 14 * 60,
    endMinute: 18 * 60,
    note: "[teste] prefere à tarde",
  });
  const entryB = await insertOne({ patientId: base.p2 });
  const entryRemovedPatient = await insertOne({ patientId: base.pRemoved });
  const entryGone = await insertOne({ patientId: base.p3, professionalId: gone!.id });
  const entryFulfilled = await insertOne({
    patientId: base.p1,
    status: "fulfilled",
    appointmentId: base.a1,
    closedAt: CLOSED_AT,
    closedBy: ids.admin,
  });
  const entryRemoved = await insertOne({ patientId: base.p4, status: "removed", closedAt: CLOSED_AT, closedBy: ids.admin });

  const ap = async (professionalId: string, from: string, to: string, createdAt: Date) => {
    const [row] = await tx
      .insert(appointments)
      .values({
        professionalId,
        patientId: base.p1,
        serviceId: base.serviceId,
        specialty: "physiotherapy",
        startsAt: at("2031-06-04", from),
        endsAt: at("2031-06-04", to),
        createdBy: ids.admin,
        createdAt,
        updatedAt: createdAt,
      })
      .returning({ id: appointments.id });
    return row!.id;
  };
  const apFresh = await ap(base.professionalA, "09:00", "09:50", new Date("2026-02-01T00:00:00Z"));
  const apOtherPro = await ap(base.professionalB, "10:00", "10:50", new Date("2026-02-01T00:00:00Z"));
  const apStale = await ap(base.professionalA, "11:00", "11:50", new Date("2025-12-31T00:00:00Z"));

  const allEntries = [entryA, entryB, entryRemovedPatient, entryGone, entryFulfilled, entryRemoved];
  return {
    ...base,
    professionalGone: gone!.id,
    entryA,
    entryB,
    entryRemovedPatient,
    entryGone,
    entryFulfilled,
    entryRemoved,
    apFresh,
    apOtherPro,
    apStale,
    allEntries,
    receptionEntries: [entryA, entryB, entryFulfilled, entryRemoved],
  };
}
