import "server-only";

import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";

import type { Specialty } from "@/lib/catalog/labels";
import type { WorkRange } from "@/lib/schedule/week";
import { professionalTimeOff, professionalWorkHours, professionals } from "@/server/db/schema";
import { withUser } from "@/server/db/with-user";

/**
 * Consultas da grade de horários. Todas passam por `withUser` (RLS de verdade): a recepção lê a
 * de todos os profissionais não removidos; o PROFISSIONAL só lê a própria; quem não pode ver
 * recebe vazio/`null` do próprio banco (o código não repete a regra por papel). ID que não é
 * UUID nunca chega ao banco.
 */
export type ScheduleUser = { userId: string };

export type TimeOffRow = { id: string; startsAt: Date; endsAt: Date; reason: string | null };

export type ScheduleOwner = { id: string; fullName: string; specialty: Specialty; active: boolean };

const uuid = z.guid();
/** Folgas já terminadas há mais que isto saem da lista (a tela mostra as futuras e as recentes). */
const RECENT_DAYS = 30;

/** O profissional dono da grade (cabeçalho da tela). `null` se não existe, foi removido ou a RLS o esconde. */
export async function getScheduleOwner(user: ScheduleUser, professionalId: string): Promise<ScheduleOwner | null> {
  if (!uuid.safeParse(professionalId).success) return null;
  const [row] = await withUser(user, (tx) =>
    tx
      .select({
        id: professionals.id,
        fullName: professionals.fullName,
        specialty: professionals.specialty,
        active: professionals.active,
      })
      .from(professionals)
      .where(and(eq(professionals.id, professionalId), isNull(professionals.deletedAt))),
  );
  return row ?? null;
}

/** A grade semanal, ordenada por dia e início. */
export async function getWeek(user: ScheduleUser, professionalId: string): Promise<WorkRange[]> {
  if (!uuid.safeParse(professionalId).success) return [];
  return withUser(user, (tx) =>
    tx
      .select({
        weekday: professionalWorkHours.weekday,
        start: professionalWorkHours.startMinute,
        end: professionalWorkHours.endMinute,
      })
      .from(professionalWorkHours)
      .where(eq(professionalWorkHours.professionalId, professionalId))
      .orderBy(asc(professionalWorkHours.weekday), asc(professionalWorkHours.startMinute)),
  );
}

/** Folgas e bloqueios que ainda não terminaram ou terminaram nos últimos 30 dias, em ordem de início. */
export async function listTimeOff(
  user: ScheduleUser,
  professionalId: string,
  options: { now?: Date } = {},
): Promise<TimeOffRow[]> {
  if (!uuid.safeParse(professionalId).success) return [];
  const since = new Date((options.now ?? new Date()).getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  return withUser(user, (tx) =>
    tx
      .select({
        id: professionalTimeOff.id,
        startsAt: professionalTimeOff.startsAt,
        endsAt: professionalTimeOff.endsAt,
        reason: professionalTimeOff.reason,
      })
      .from(professionalTimeOff)
      .where(and(eq(professionalTimeOff.professionalId, professionalId), gte(professionalTimeOff.endsAt, since)))
      .orderBy(asc(professionalTimeOff.startsAt)),
  );
}
