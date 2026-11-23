import "server-only";

import { and, asc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";

import { classifyOccurrence, type BusyInterval } from "@/lib/appointments/series";
import { matchesPreference } from "@/lib/waitlist/match";
import type { FreedSlot } from "@/server/appointments/mutations";
import { withoutQueryDetails } from "@/server/db/pg-error";
import {
  appointments,
  patients,
  professionalServices,
  professionalTimeOff,
  professionalWorkHours,
  professionals,
  services,
  waitlistEntries,
} from "@/server/db/schema";
import { withUser } from "@/server/db/with-user";

import { WAITLIST_LIMIT, type WaitlistUser } from "./queries";

/**
 * Quem da lista de espera cabe num horário que acabou de vagar (Fase 3B-2). Só LÊ: nada é criado aqui
 * (agendar é `bookFromWaitlist`, outra transação, que confere tudo de novo). Cabe = a espera está
 * aberta; o serviço está ativo e o profissional o oferece; a espera pede este profissional ou
 * "qualquer"; o dia e a faixa de horário batem; e `classifyOccurrence` aceita o horário (não passou,
 * está na grade, fora das folgas e sem colisão do profissional nem do paciente). O atendimento começa
 * no início do horário liberado e dura o que o SERVIÇO dura (não o que o buraco tinha).
 *
 * É só uma sugestão: a barreira de verdade é a transação de agendar e a exclusão do banco. Pela RLS, só
 * admin e recepção enxergam esperas; para o profissional a lista vem vazia.
 * DADO SENSÍVEL: nome de paciente; nada daqui é logado e a falha sobe sem a consulta e os parâmetros.
 */
export type Candidate = {
  entryId: string;
  patientId: string;
  patientName: string;
  serviceId: string;
  serviceName: string;
  startsAt: Date;
  endsAt: Date;
};

/** Quantos candidatos a gaveta mostra (por ordem de chegada). */
export const MAX_CANDIDATES = 10;

const MINUTE_MS = 60_000;

export async function findCandidates(user: WaitlistUser, freed: FreedSlot, now: Date = new Date()): Promise<Candidate[]> {
  try {
    return await withUser(user, async (tx) => {
      const waiting = await tx
        .select({
          entryId: waitlistEntries.id,
          patientId: waitlistEntries.patientId,
          patientName: patients.fullName,
          serviceId: waitlistEntries.serviceId,
          serviceName: services.name,
          durationMinutes: services.durationMinutes,
          weekdays: waitlistEntries.weekdays,
          startMinute: waitlistEntries.startMinute,
          endMinute: waitlistEntries.endMinute,
        })
        .from(waitlistEntries)
        .innerJoin(patients, and(eq(patients.id, waitlistEntries.patientId), isNull(patients.deletedAt)))
        .innerJoin(services, and(eq(services.id, waitlistEntries.serviceId), eq(services.active, true), isNull(services.deletedAt)))
        .innerJoin(
          professionals,
          and(eq(professionals.id, freed.professionalId), eq(professionals.active, true), isNull(professionals.deletedAt)),
        )
        .innerJoin(
          professionalServices,
          and(
            eq(professionalServices.serviceId, waitlistEntries.serviceId),
            eq(professionalServices.professionalId, freed.professionalId),
          ),
        )
        .where(
          and(
            eq(waitlistEntries.status, "waiting"),
            eq(waitlistEntries.specialty, freed.specialty),
            or(isNull(waitlistEntries.professionalId), eq(waitlistEntries.professionalId, freed.professionalId)),
          ),
        )
        .orderBy(asc(waitlistEntries.createdAt), asc(waitlistEntries.id))
        .limit(WAITLIST_LIMIT);

      const preferred = waiting
        .map((row) => ({
          ...row,
          startsAt: freed.startsAt,
          endsAt: new Date(freed.startsAt.getTime() + row.durationMinutes * MINUTE_MS),
        }))
        .filter((row) => matchesPreference(row, row));
      if (preferred.length === 0) return [];

      const from = freed.startsAt;
      const to = new Date(Math.max(...preferred.map((row) => row.endsAt.getTime())));

      const hours = await tx
        .select({ weekday: professionalWorkHours.weekday, start: professionalWorkHours.startMinute, end: professionalWorkHours.endMinute })
        .from(professionalWorkHours)
        .where(eq(professionalWorkHours.professionalId, freed.professionalId));
      const timeOff = await tx
        .select({ startsAt: professionalTimeOff.startsAt, endsAt: professionalTimeOff.endsAt })
        .from(professionalTimeOff)
        .where(
          and(
            eq(professionalTimeOff.professionalId, freed.professionalId),
            lt(professionalTimeOff.startsAt, to),
            gt(professionalTimeOff.endsAt, from),
          ),
        );
      // Só o que ainda ocupa o horário (a cancelada libera), do profissional e dos pacientes candidatos.
      const live = await tx
        .select({
          professionalId: appointments.professionalId,
          patientId: appointments.patientId,
          startsAt: appointments.startsAt,
          endsAt: appointments.endsAt,
        })
        .from(appointments)
        .where(
          and(
            ne(appointments.status, "cancelled"),
            lt(appointments.startsAt, to),
            gt(appointments.endsAt, from),
            or(
              eq(appointments.professionalId, freed.professionalId),
              inArray(appointments.patientId, [...new Set(preferred.map((row) => row.patientId))]),
            ),
          ),
        );

      const busyProfessional: BusyInterval[] = live.filter((row) => row.professionalId === freed.professionalId);
      const ranges = hours.map((row) => ({ weekday: row.weekday, start: row.start, end: row.end }));

      return preferred
        .filter((row) =>
          classifyOccurrence({
            occurrence: row,
            now,
            ranges,
            timeOff,
            busyProfessional,
            busyPatient: live.filter((other) => other.patientId === row.patientId),
          }).ok,
        )
        .slice(0, MAX_CANDIDATES)
        .map(({ entryId, patientId, patientName, serviceId, serviceName, startsAt, endsAt }) => ({
          entryId,
          patientId,
          patientName,
          serviceId,
          serviceName,
          startsAt,
          endsAt,
        }));
    });
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
