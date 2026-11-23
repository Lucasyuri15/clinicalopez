import "server-only";

import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";

import type { Specialty } from "@/lib/catalog/labels";
import type { WaitlistView } from "@/lib/waitlist/filters";
import { withoutQueryDetails } from "@/server/db/pg-error";
import { patients, professionals, services, waitlistEntries, type WaitlistStatus } from "@/server/db/schema";
import { withUser } from "@/server/db/with-user";

/**
 * Consultas da lista de espera (Fase 3B), sempre por `withUser` (RLS de verdade): o admin lê todas; a
 * recepção, as de paciente e profissional não removidos; o PROFISSIONAL não lê NADA (não há política
 * para ele), então esta consulta devolve lista vazia para o login dele. O código não repete essa
 * regra por papel; as ações e a tela ainda exigem admin ou recepção.
 *
 * DADO SENSÍVEL: a nota é texto livre e o nome é do paciente; nada daqui é logado e a falha do banco
 * sobe sem a consulta e os parâmetros.
 */
export type WaitlistUser = { userId: string };

export type WaitlistFilters = {
  view: WaitlistView;
  specialty?: Specialty;
  /** Só as esperas que pedem ESTE profissional (as "qualquer" não entram). */
  professionalId?: string;
};

export type WaitlistItem = {
  id: string;
  patientId: string;
  patientName: string;
  serviceId: string;
  serviceName: string;
  specialty: Specialty;
  professionalId: string | null;
  professionalName: string | null;
  /** 0 = domingo a 6; vazio = qualquer dia. */
  weekdays: number[];
  /** Minutos desde a meia-noite de Brasília; nulos = qualquer horário. */
  startMinute: number | null;
  endMinute: number | null;
  note: string | null;
  status: WaitlistStatus;
  createdAt: Date;
  closedAt: Date | null;
};

/** Teto de uma consulta (a espera de uma clínica pequena cabe com folga). */
export const WAITLIST_LIMIT = 500;

const CLOSED: WaitlistStatus[] = ["fulfilled", "removed"];

/**
 * As abertas, por ordem de chegada (quem espera há mais tempo primeiro), ou as encerradas, da mais
 * recente para a mais antiga.
 */
export async function listWaitlist(user: WaitlistUser, filters: WaitlistFilters): Promise<WaitlistItem[]> {
  const open = filters.view === "open";
  const conditions: SQL[] = [open ? eq(waitlistEntries.status, "waiting") : inArray(waitlistEntries.status, CLOSED)];
  if (filters.specialty) conditions.push(eq(waitlistEntries.specialty, filters.specialty));
  if (filters.professionalId) conditions.push(eq(waitlistEntries.professionalId, filters.professionalId));

  try {
    return await withUser(user, (tx) =>
      tx
        .select({
          id: waitlistEntries.id,
          patientId: waitlistEntries.patientId,
          patientName: patients.fullName,
          serviceId: waitlistEntries.serviceId,
          serviceName: services.name,
          specialty: waitlistEntries.specialty,
          professionalId: waitlistEntries.professionalId,
          professionalName: professionals.fullName,
          weekdays: waitlistEntries.weekdays,
          startMinute: waitlistEntries.startMinute,
          endMinute: waitlistEntries.endMinute,
          note: waitlistEntries.note,
          status: waitlistEntries.status,
          createdAt: waitlistEntries.createdAt,
          closedAt: waitlistEntries.closedAt,
        })
        .from(waitlistEntries)
        .innerJoin(patients, eq(patients.id, waitlistEntries.patientId))
        .innerJoin(services, eq(services.id, waitlistEntries.serviceId))
        .leftJoin(professionals, eq(professionals.id, waitlistEntries.professionalId))
        .where(and(...conditions))
        .orderBy(open ? asc(waitlistEntries.createdAt) : desc(waitlistEntries.closedAt), asc(waitlistEntries.id))
        .limit(WAITLIST_LIMIT),
    );
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
