import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import type { WorkRange } from "@/lib/schedule/week";
import { pgErrorCode } from "@/server/db/pg-error";
import { professionalTimeOff, professionalWorkHours, professionals } from "@/server/db/schema";
import { withUser } from "@/server/db/with-user";

import type { ScheduleUser } from "./queries";

/**
 * Gravações da grade de horários, sempre por `withUser` (a RLS só deixa admin e recepção gravar; a
 * camada de ações ainda exige `requireRole("admin", "reception")`). O resultado é um valor, não uma exceção.
 * - `overlap`: o banco recusou faixas sobrepostas (exclusão do mesmo profissional/dia).
 * - `not-found`: o profissional não existe, foi removido ou a RLS o esconde; ou nada a remover.
 * - `denied`: o banco recusou (sem permissão, valor fora dos limites, profissional removido...).
 */
export type ScheduleResult =
  | { ok: true; id: string }
  | { ok: false; reason: "overlap" | "not-found" | "denied" };

type Failure = Extract<ScheduleResult, { ok: false }>;

/** Lançada dentro da transação para DESFAZÊ-LA e devolver um resultado já conhecido. */
class Abort extends Error {
  constructor(readonly failure: Failure) {
    super(failure.reason);
  }
}

function toFailure(error: unknown): Failure {
  if (error instanceof Abort) return error.failure;
  switch (pgErrorCode(error)) {
    case "23P01": // exclusion_violation: faixas sobrepostas
      return { ok: false, reason: "overlap" };
    case "42501": // sem permissão (RLS)
    case "23503": // chave estrangeira
    case "23514": // check
    case "22021": // byte inválido no texto
    case "22P02": // texto inválido para o tipo
      return { ok: false, reason: "denied" };
    default:
      // Erro inesperado (conexão...): não engolir.
      throw error;
  }
}

async function guarded(run: () => Promise<ScheduleResult>): Promise<ScheduleResult> {
  try {
    return await run();
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Grava a semana INTEIRA do profissional: apaga as faixas atuais e cria as novas, numa única
 * transação (qualquer erro desfaz tudo: a grade anterior continua). Uma TRAVA por profissional
 * serializa duas gravações simultâneas: a segunda espera a primeira terminar e então substitui,
 * em vez de esbarrar nas faixas ainda não confirmadas da outra.
 */
export function saveWeek(user: ScheduleUser, input: { professionalId: string; ranges: readonly WorkRange[] }) {
  const { professionalId, ranges } = input;
  return guarded(() =>
    withUser(user, async (tx): Promise<ScheduleResult> => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scheduleLockKey(professionalId)}, 0))`);

      const [owner] = await tx
        .select({ id: professionals.id })
        .from(professionals)
        .where(and(eq(professionals.id, professionalId), isNull(professionals.deletedAt)));
      if (!owner) throw new Abort({ ok: false, reason: "not-found" });

      // Quem não pode apagar (a RLS esconde ou nega) apaga 0 linhas SEM erro: confere que saiu
      // tudo o que se via, senão "limpar a semana" viraria um sucesso falso.
      const before = await tx
        .select({ id: professionalWorkHours.id })
        .from(professionalWorkHours)
        .where(eq(professionalWorkHours.professionalId, professionalId));
      const removed = await tx
        .delete(professionalWorkHours)
        .where(eq(professionalWorkHours.professionalId, professionalId))
        .returning({ id: professionalWorkHours.id });
      if (removed.length !== before.length) throw new Abort({ ok: false, reason: "denied" });

      if (ranges.length > 0) {
        await tx.insert(professionalWorkHours).values(
          ranges.map((range) => ({
            professionalId,
            weekday: range.weekday,
            startMinute: range.start,
            endMinute: range.end,
          })),
        );
      }
      return { ok: true, id: professionalId };
    }),
  );
}

/**
 * A chave da trava da agenda de um profissional. `saveWeek` e `addTimeOff` tomam a trava EXCLUSIVA;
 * uma reserva de atendimento (Fase 2) toma a COMPARTILHADA antes de ler a grade e as folgas. Assim
 * uma folga nova espera as reservas em andamento e nenhuma reserva grava em cima de uma folga que
 * acabou de ser criada. Um atendimento que JÁ existe não é reescrito (contrato da 1B-2b).
 */
export const scheduleLockKey = (professionalId: string) => `work-hours:${professionalId}`;

export function addTimeOff(
  user: ScheduleUser,
  input: { professionalId: string; startsAt: Date; endsAt: Date; reason: string | null },
) {
  return guarded(async () => {
    const [row] = await withUser(user, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${scheduleLockKey(input.professionalId)}, 0))`);
      return tx
        .insert(professionalTimeOff)
        .values({
          professionalId: input.professionalId,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          reason: input.reason,
        })
        .returning({ id: professionalTimeOff.id });
    });
    return row ? { ok: true, id: row.id } : { ok: false, reason: "denied" };
  });
}

export function removeTimeOff(user: ScheduleUser, timeOffId: string) {
  return guarded(async () => {
    const rows = await withUser(user, (tx) =>
      tx
        .delete(professionalTimeOff)
        .where(eq(professionalTimeOff.id, timeOffId))
        .returning({ id: professionalTimeOff.id }),
    );
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, reason: "not-found" };
  });
}
