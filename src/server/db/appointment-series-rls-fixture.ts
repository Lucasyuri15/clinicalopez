import { randomUUID } from "node:crypto";

import { type AgendaSeed, FUTURE_DAY, at, seedAgenda } from "./appointments-rls-fixture";
import type { Tx } from "./client";
import { appointmentSeries, appointments, professionals } from "./schema";

/**
 * Cenário dos testes de RLS das séries (`appointment-series-rls.test.ts` e
 * `appointment-series-rls-write.test.ts`). Só dados FICTÍCIOS; só `*.test.ts` importam. Parte do
 * cenário da agenda (`seedAgenda`) e acrescenta, pelo dono do banco:
 *  seriesA     pA + p1 + serviço  (admin)   com uma sessão futura: sessionA, 2031-06-09 13:00–13:50Z
 *  seriesB     pB + p2 + serviço  (admin)   com uma sessão futura: sessionB, 2031-06-09 13:00–13:50Z
 *  seriesGone  pGone (profissional REMOVIDO) + p1 + serviço: a recepção não a enxerga
 */
export const SERIES_DAY = "2031-06-09";

export type SeriesSeed = AgendaSeed & {
  seriesA: string;
  seriesB: string;
  seriesGone: string;
  sessionA: string;
  sessionB: string;
  professionalGone: string;
  allSeries: string[];
};

export async function seedSeries(
  tx: Tx,
  ids: { admin: string; professional: string; professional2: string },
  label: string,
): Promise<SeriesSeed> {
  const base = await seedAgenda(tx, ids, label);
  const [gone] = await tx
    .insert(professionals)
    .values({
      fullName: `[teste] Removida ${label} ${randomUUID().slice(0, 8)}`,
      specialty: "physiotherapy",
      deletedAt: new Date(),
    })
    .returning({ id: professionals.id });

  const identity = (professionalId: string, patientId: string) => ({
    professionalId,
    patientId,
    serviceId: base.serviceId,
    specialty: "physiotherapy" as const,
    createdBy: ids.admin,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  const [sA] = await tx.insert(appointmentSeries).values(identity(base.professionalA, base.p1)).returning({ id: appointmentSeries.id });
  const [sB] = await tx.insert(appointmentSeries).values(identity(base.professionalB, base.p2)).returning({ id: appointmentSeries.id });
  const [sGone] = await tx.insert(appointmentSeries).values(identity(gone!.id, base.p1)).returning({ id: appointmentSeries.id });

  const session = async (seriesId: string, professionalId: string, patientId: string) => {
    const [row] = await tx
      .insert(appointments)
      .values({
        seriesId,
        professionalId,
        patientId,
        serviceId: base.serviceId,
        specialty: "physiotherapy",
        startsAt: at(SERIES_DAY, "13:00"),
        endsAt: at(SERIES_DAY, "13:50"),
        createdBy: ids.admin,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      })
      .returning({ id: appointments.id });
    return row!.id;
  };
  const sessionA = await session(sA!.id, base.professionalA, base.p1);
  const sessionB = await session(sB!.id, base.professionalB, base.p2);

  return {
    ...base,
    seriesA: sA!.id,
    seriesB: sB!.id,
    seriesGone: sGone!.id,
    sessionA,
    sessionB,
    professionalGone: gone!.id,
    allSeries: [sA!.id, sB!.id, sGone!.id],
  };
}

export { FUTURE_DAY, at };
