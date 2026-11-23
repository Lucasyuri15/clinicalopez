import "server-only";

import { and, eq, gt, gte, inArray, lt, ne, notInArray } from "drizzle-orm";

import {
  classifyOccurrence,
  shiftSeriesFrom,
  type BusyInterval,
  type Occurrence,
  type OccurrenceReason,
  type OccurrenceVerdict,
  type SeriesMember,
} from "@/lib/appointments/series";
import { wallParts } from "@/lib/datetime";
import type { TimeOffWindow } from "@/lib/schedule/availability";
import { formatTime } from "@/lib/schedule/time";
import type { WorkRange } from "@/lib/schedule/week";
import { pgConstraintName, pgErrorCode } from "@/server/db/pg-error";
import { appointmentSeries, appointments, professionalTimeOff, professionalWorkHours } from "@/server/db/schema";
import { withUser, type Tx } from "@/server/db/with-user";

import {
  Abort,
  guarded,
  insertOccurrence,
  linkPatient,
  loadBookingContext,
  lockSchedule,
  OPEN,
  type AppointmentFailure,
  type AppointmentResult,
  type BookingContext,
} from "./mutations";
import type { AppointmentUser } from "./queries";

/**
 * Séries de sessões (Fase 3A), sempre por `withUser`. Uma série é um grupo de atendimentos comuns
 * (`appointments.series_id`): o conflito de horário continua sendo das exclusões do banco. O
 * resultado é um VALOR (nunca o erro do banco). Decisões do dono:
 *  - a prévia (`previewSeries`) só LÊ e diz por que cada data cabe ou não;
 *  - criar/renovar grava SÓ as datas que cabem e lista as puladas (com o motivo); se nenhuma cabe,
 *    devolve `nothing-fits` e não grava NADA (nem série, nem vínculo);
 *  - cada sessão entra num SAVEPOINT: uma data que perde a corrida contra outra reserva (23P01) vira
 *    "pulada" sem derrubar as outras. A prévia é informativa; a barreira final é o banco.
 * Quem chama passa as datas já calculadas e validadas (`createSeriesSchema` / `renewSeriesSchema`).
 */
export type SeriesRequest = {
  patientId: string;
  professionalId: string;
  serviceId: string;
  occurrences: readonly Occurrence[];
};

export type SeriesPreviewItem = { startsAt: Date; endsAt: Date; verdict: OccurrenceVerdict };
export type PlacedSessions = {
  created: { id: string; startsAt: Date }[];
  skipped: { startsAt: Date; reason: OccurrenceReason }[];
};

type Failure = Extract<AppointmentResult, { ok: false }>;
export type SeriesPreviewResult = { ok: true; items: SeriesPreviewItem[] } | Failure;
export type SeriesResult = ({ ok: true; seriesId: string } & PlacedSessions) | Failure;

type Calendar = {
  ranges: WorkRange[];
  timeOff: TimeOffWindow[];
  busyProfessional: BusyInterval[];
  busyPatient: BusyInterval[];
};

/**
 * Lê UMA vez a grade, as folgas e os atendimentos (que ainda ocupam o horário: só a cancelada libera) do
 * profissional e do paciente na janela das datas, para classificar todas sem uma consulta por data.
 */
async function readCalendar(
  tx: Tx,
  professionalId: string,
  patientId: string,
  occurrences: readonly BusyInterval[],
  /** Sessões que estão sendo MOVIDAS: o horário antigo delas não conta como ocupado. */
  excludeIds: readonly string[] = [],
): Promise<Calendar> {
  const from = new Date(Math.min(...occurrences.map((item) => item.startsAt.getTime())));
  const to = new Date(Math.max(...occurrences.map((item) => item.endsAt.getTime())));

  const hours = await tx
    .select({ weekday: professionalWorkHours.weekday, start: professionalWorkHours.startMinute, end: professionalWorkHours.endMinute })
    .from(professionalWorkHours)
    .where(eq(professionalWorkHours.professionalId, professionalId));
  const timeOff = await tx
    .select({ startsAt: professionalTimeOff.startsAt, endsAt: professionalTimeOff.endsAt })
    .from(professionalTimeOff)
    .where(
      and(eq(professionalTimeOff.professionalId, professionalId), lt(professionalTimeOff.startsAt, to), gt(professionalTimeOff.endsAt, from)),
    );
  const busy = (column: typeof appointments.professionalId | typeof appointments.patientId, id: string) =>
    tx
      .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
      .from(appointments)
      .where(
        and(
          eq(column, id),
          ne(appointments.status, "cancelled"),
          lt(appointments.startsAt, to),
          gt(appointments.endsAt, from),
          excludeIds.length > 0 ? notInArray(appointments.id, [...excludeIds]) : undefined,
        ),
      );

  return {
    ranges: hours.map((row) => ({ weekday: row.weekday, start: row.start, end: row.end })),
    timeOff,
    busyProfessional: await busy(appointments.professionalId, professionalId),
    busyPatient: await busy(appointments.patientId, patientId),
  };
}

function classifyAll(occurrences: readonly BusyInterval[], calendar: Calendar, now: Date): OccurrenceVerdict[] {
  return occurrences.map((occurrence) => classifyOccurrence({ occurrence, now, ...calendar }));
}

/** A identidade (profissional, paciente, serviço) de uma série existente; some se a RLS a esconde. */
async function loadSeries(tx: Tx, seriesId: string) {
  const [row] = await tx
    .select({
      professionalId: appointmentSeries.professionalId,
      patientId: appointmentSeries.patientId,
      serviceId: appointmentSeries.serviceId,
    })
    .from(appointmentSeries)
    .where(eq(appointmentSeries.id, seriesId));
  if (!row) throw new Abort("not-found");
  return row;
}

/**
 * Grava as datas que cabem, cada uma num savepoint. As que não cabem (ou perdem a corrida) vão para
 * `skipped`, em ordem de data. Sem nenhuma gravada, `Abort("nothing-fits")` desfaz a transação inteira.
 */
async function placeSessions(
  tx: Tx,
  ctx: BookingContext,
  seriesId: string,
  occurrences: readonly Occurrence[],
  now: Date,
): Promise<PlacedSessions> {
  const verdicts = classifyAll(occurrences, await readCalendar(tx, ctx.professionalId, ctx.patientId, occurrences), now);
  const skipped: PlacedSessions["skipped"] = [];
  const created: PlacedSessions["created"] = [];

  for (const [index, occurrence] of occurrences.entries()) {
    const verdict = verdicts[index];
    if (!verdict?.ok) {
      skipped.push({ startsAt: occurrence.startsAt, reason: verdict?.reason ?? "invalid" });
      continue;
    }
    try {
      const id = await tx.transaction((savepoint) => insertOccurrence(savepoint as unknown as Tx, ctx, occurrence, seriesId));
      created.push({ id, startsAt: occurrence.startsAt });
    } catch (error) {
      const code = pgErrorCode(error);
      // 42501 aqui só pode ser a política de INSERT `starts_at >= now()`: o relógio do BANCO já passou desta
      // data (relógio do app um pouco atrasado, ou início nos próximos segundos). Vira data pulada.
      if (code === "42501") {
        skipped.push({ startsAt: occurrence.startsAt, reason: "past" });
        continue;
      }
      if (code !== "23P01") throw error;
      skipped.push({
        startsAt: occurrence.startsAt,
        reason: pgConstraintName(error) === "appointments_patient_no_overlap" ? "conflict-patient" : "conflict-professional",
      });
    }
  }
  if (created.length === 0) throw new Abort("nothing-fits");
  skipped.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return { created, skipped };
}

/** Só LÊ: a situação de cada data da série pedida (nada é gravado e nenhuma trava é tomada). */
export function previewSeries(user: AppointmentUser, input: SeriesRequest, now: Date = new Date()): Promise<SeriesPreviewResult> {
  return guarded(
    () =>
      withUser(user, async (tx): Promise<SeriesPreviewResult> => {
        await loadBookingContext(tx, input, { price: false });
        const calendar = await readCalendar(tx, input.professionalId, input.patientId, input.occurrences);
        const verdicts = classifyAll(input.occurrences, calendar, now);
        return {
          ok: true,
          items: input.occurrences.map((occurrence, index) => ({
            startsAt: occurrence.startsAt,
            endsAt: occurrence.endsAt,
            verdict: verdicts[index] ?? { ok: false, reason: "invalid" },
          })),
        };
      }),
    "denied",
    "denied",
  );
}

/** A prévia de uma RENOVAÇÃO: as mesmas datas classificadas sobre a série existente (só LÊ). */
export function previewRenewal(
  user: AppointmentUser,
  input: { seriesId: string; occurrences: readonly Occurrence[] },
  now: Date = new Date(),
): Promise<SeriesPreviewResult> {
  return guarded(
    () =>
      withUser(user, async (tx): Promise<SeriesPreviewResult> => {
        const identity = await loadSeries(tx, input.seriesId);
        await loadBookingContext(tx, identity, { price: false });
        const calendar = await readCalendar(tx, identity.professionalId, identity.patientId, input.occurrences);
        const verdicts = classifyAll(input.occurrences, calendar, now);
        return {
          ok: true,
          items: input.occurrences.map((occurrence, index) => ({
            startsAt: occurrence.startsAt,
            endsAt: occurrence.endsAt,
            verdict: verdicts[index] ?? { ok: false, reason: "invalid" },
          })),
        };
      }),
    "denied",
    "denied",
  );
}

/**
 * Cria a série e as sessões que cabem, numa única transação: trava compartilhada da agenda do
 * profissional → confere profissional, serviço e paciente → série → sessões (valor copiado em cada uma)
 * → vínculo paciente↔profissional. Nenhuma cabe: `nothing-fits` e nada fica para trás.
 */
export function createSeries(user: AppointmentUser, input: SeriesRequest, now: Date = new Date()): Promise<SeriesResult> {
  return guarded(
    () =>
      withUser(user, async (tx): Promise<SeriesResult> => {
        await lockSchedule(tx, input.professionalId);
        const ctx = await loadBookingContext(tx, input);

        const [series] = await tx
          .insert(appointmentSeries)
          .values({ professionalId: ctx.professionalId, patientId: ctx.patientId, serviceId: ctx.serviceId, specialty: ctx.specialty })
          .returning({ id: appointmentSeries.id });
        if (!series) throw new Abort("denied");

        const placed = await placeSessions(tx, ctx, series.id, input.occurrences, now);
        await linkPatient(tx, ctx);
        return { ok: true, seriesId: series.id, ...placed };
      }),
    "denied",
    "denied",
  );
}

/** Renovar: mais sessões na MESMA série (profissional, paciente e serviço vêm dela), com as mesmas regras. */
export function renewSeries(
  user: AppointmentUser,
  input: { seriesId: string; occurrences: readonly Occurrence[] },
  now: Date = new Date(),
): Promise<SeriesResult> {
  return guarded(
    () =>
      withUser(user, async (tx): Promise<SeriesResult> => {
        const identity = await loadSeries(tx, input.seriesId);
        await lockSchedule(tx, identity.professionalId);
        const ctx = await loadBookingContext(tx, identity);

        const placed = await placeSessions(tx, ctx, input.seriesId, input.occurrences, now);
        await linkPatient(tx, ctx);
        return { ok: true, seriesId: input.seriesId, ...placed };
      }),
    "denied",
    "denied",
  );
}

const FAILURE_OF: Record<OccurrenceReason, AppointmentFailure> = {
  past: "past",
  invalid: "invalid-slot",
  "crosses-midnight": "invalid-slot",
  "outside-grid": "outside-grid",
  "time-off": "time-off",
  "conflict-professional": "conflict-professional",
  "conflict-patient": "conflict-patient",
};

export type CancelSeriesResult = { ok: true; count: number } | Failure;

/**
 * "Cancelar daqui para frente": cancela, com o motivo, a sessão escolhida e TODAS as seguintes da série
 * que ainda estão abertas (agendada ou confirmada). Não toca nas anteriores nem nas já realizadas,
 * com falta ou canceladas. Um único `UPDATE`: o gatilho do banco confere cada linha (o profissional
 * não cancela). Sessão avulsa ou inexistente: `not-found`; a escolhida já fechada: `changed`.
 */
export function cancelSeriesFrom(user: AppointmentUser, input: { id: string; reason: string }): Promise<CancelSeriesResult> {
  return guarded(
    () =>
      withUser(user, async (tx): Promise<CancelSeriesResult> => {
        const [anchor] = await tx
          .select({ seriesId: appointments.seriesId, startsAt: appointments.startsAt, status: appointments.status })
          .from(appointments)
          .where(eq(appointments.id, input.id));
        if (!anchor?.seriesId) throw new Abort("not-found");
        if (!(OPEN as readonly string[]).includes(anchor.status)) throw new Abort("changed");

        const rows = await tx
          .update(appointments)
          .set({ status: "cancelled", cancelReason: input.reason })
          .where(
            and(eq(appointments.seriesId, anchor.seriesId), gte(appointments.startsAt, anchor.startsAt), inArray(appointments.status, [...OPEN])),
          )
          .returning({ id: appointments.id });
        return { ok: true, count: rows.length };
      }),
    "not-allowed",
    "denied",
  );
}

/** Uma sessão que NÃO foi movida: continua em `from`; `to` é a data para a qual não coube. */
export type UnmovedSession = { from: Date; to: Date; reason: OccurrenceReason };
export type RescheduleSeriesResult = { ok: true; moved: { id: string; startsAt: Date }[]; skipped: UnmovedSession[] } | Failure;

/**
 * "Remarcar daqui para frente": leva a sessão escolhida para o novo dia/horário/duração e desloca as
 * seguintes abertas pelo mesmo número de dias (`shiftSeriesFrom`, na ordem que evita colisão entre
 * as irmãs), voltando para Agendada. Cada uma entra num savepoint: a que não cabe (folga, grade,
 * passado, conflito) FICA onde está e é listada. Se a PRÓPRIA sessão escolhida não cabe, recusa com o
 * motivo e não move nenhuma.
 */
export function rescheduleSeriesFrom(
  user: AppointmentUser,
  input: { id: string; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): Promise<RescheduleSeriesResult> {
  return guarded(
    () =>
      withUser(user, async (tx): Promise<RescheduleSeriesResult> => {
        const [anchor] = await tx
          .select({
            seriesId: appointments.seriesId,
            professionalId: appointments.professionalId,
            patientId: appointments.patientId,
            status: appointments.status,
          })
          .from(appointments)
          .where(eq(appointments.id, input.id));
        if (!anchor?.seriesId) throw new Abort("not-found");
        if (!(OPEN as readonly string[]).includes(anchor.status)) throw new Abort("changed");

        await lockSchedule(tx, anchor.professionalId);
        const members = await tx
          .select({ id: appointments.id, startsAt: appointments.startsAt, endsAt: appointments.endsAt, status: appointments.status })
          .from(appointments)
          .where(eq(appointments.seriesId, anchor.seriesId));

        // A sessão escolhida pode ter sido fechada entre a primeira leitura e esta: não é "nada a mover".
        const anchorNow = members.find((member) => member.id === input.id);
        if (!anchorNow || !(OPEN as readonly string[]).includes(anchorNow.status)) throw new Abort("changed");

        const wall = wallParts(input.startsAt);
        const moves = shiftSeriesFrom({
          members: members as SeriesMember[],
          fromId: input.id,
          newDate: wall.date,
          newTime: formatTime(wall.minute),
          newDurationMinutes: Math.round((input.endsAt.getTime() - input.startsAt.getTime()) / 60_000),
          now,
        });
        if (moves.length === 0) return { ok: true, moved: [], skipped: [] };

        const calendar = await readCalendar(
          tx,
          anchor.professionalId,
          anchor.patientId,
          moves.map((move) => move.to),
          moves.map((move) => move.id),
        );
        const moved: { id: string; startsAt: Date }[] = [];
        const skipped: UnmovedSession[] = [];

        for (const move of moves) {
          const verdict = classifyOccurrence({ occurrence: move.to, now, ...calendar });
          let reason: OccurrenceReason | null = verdict.ok ? null : verdict.reason;
          if (!reason) {
            try {
              const rows = await tx.transaction((savepoint) =>
                (savepoint as unknown as Tx)
                  .update(appointments)
                  .set({ startsAt: move.to.startsAt, endsAt: move.to.endsAt, status: "scheduled" })
                  // Só se a sessão continua EXATAMENTE como foi lida: duas remarcações da mesma série ao mesmo
                  // tempo não se sobrescrevem (a segunda reavalia a linha depois da trava e não a encontra).
                  .where(
                    and(
                      eq(appointments.id, move.id),
                      inArray(appointments.status, [...OPEN]),
                      eq(appointments.startsAt, move.from.startsAt),
                      eq(appointments.endsAt, move.from.endsAt),
                    ),
                  )
                  .returning({ id: appointments.id }),
              );
              if (rows.length === 0) throw new Abort("changed"); // mudou por outra pessoa no meio do caminho
              moved.push({ id: move.id, startsAt: move.to.startsAt });
              continue;
            } catch (error) {
              const code = pgErrorCode(error);
              // 23514 do gatilho ("o novo horário já passou"): o relógio do BANCO passou desta data.
              if (code === "23514") {
                reason = "past";
              } else if (code === "23P01") {
                reason = pgConstraintName(error) === "appointments_patient_no_overlap" ? "conflict-patient" : "conflict-professional";
              } else {
                throw error;
              }
            }
          }
          if (move.id === input.id) throw new Abort(FAILURE_OF[reason]);
          skipped.push({ from: move.from.startsAt, to: move.to.startsAt, reason });
        }
        // A ordem de APLICAÇÃO (da última para a primeira, ao andar para a frente) não é a que a tela mostra.
        moved.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
        skipped.sort((a, b) => a.from.getTime() - b.from.getTime());
        return { ok: true, moved, skipped };
      }),
    "not-allowed",
    "past",
  );
}
