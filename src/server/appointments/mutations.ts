import "server-only";

import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";

import { checkSlot, type SlotReason } from "@/lib/schedule/availability";
import type { WorkRange } from "@/lib/schedule/week";
import { checkStatusChange, type ActorRole } from "@/lib/appointments/status";
import type { ChangeableStatus } from "@/lib/appointments/schemas";
import { pgConstraintName, pgErrorCode, withoutQueryDetails } from "@/server/db/pg-error";
import {
  appointmentPrices,
  appointments,
  insurances,
  patientPrivate,
  patientProfessionals,
  patients,
  professionalServices,
  professionalTimeOff,
  professionalWorkHours,
  professionals,
  servicePrices,
  services,
} from "@/server/db/schema";
import { withUser, type Tx } from "@/server/db/with-user";
import { scheduleLockKey } from "@/server/schedule/mutations";

import type { AppointmentUser } from "./queries";

/**
 * Gravações da agenda, sempre por `withUser` (a RLS decide quem grava; a camada de ações ainda exige
 * o papel). O resultado é um VALOR, não uma exceção: o erro do banco nunca sobe para a tela (nem o
 * texto dele, que poderia trazer dado de paciente). Um pedido recusado NÃO deixa nada para trás: tudo
 * (atendimento, valor e vínculo) vai numa única transação.
 *
 *  - `not-found`: profissional (ativo), paciente ou atendimento não existe, foi removido ou a RLS o esconde;
 *  - `service-not-offered`: o profissional não oferece o serviço (ou o serviço está inativo);
 *  - `past`: o início já passou; `invalid-slot`: horário inválido; `outside-grid` / `time-off`: fora
 *    da grade ou em cima de uma folga/bloqueio (sem encaixe: decisão do dono);
 *  - `conflict-professional` / `conflict-patient`: o BANCO recusou a sobreposição (exclusão), sem
 *    revelar o outro atendimento;
 *  - `nothing-fits`: nenhuma data de uma série cabe (nada é gravado);
 *  - `changed`: o atendimento já não está nesse estado (outra pessoa mudou antes); `too-early`:
 *    Realizada/Falta só depois do início; `not-allowed`: o papel não pode essa mudança;
 *  - `denied`: o banco recusou (sem permissão, valor inválido...); `busy`: deadlock/serialização,
 *    é só tentar de novo.
 */
export type AppointmentFailure =
  | "not-found"
  | "service-not-offered"
  | "past"
  | "invalid-slot"
  | "outside-grid"
  | "time-off"
  | "conflict-professional"
  | "conflict-patient"
  | "nothing-fits"
  | "changed"
  | "too-early"
  | "not-allowed"
  | "denied"
  | "busy";

export type AppointmentResult = { ok: true; id: string } | { ok: false; reason: AppointmentFailure };

/** Lançada dentro da transação para DESFAZÊ-LA e devolver um resultado já conhecido. */
export class Abort extends Error {
  constructor(readonly reason: AppointmentFailure) {
    super(reason);
  }
}

export const OPEN = ["scheduled", "confirmed"] as const;

/**
 * Mapeia o erro do banco. `onPermission`: o que um 42501 significa naquela operação (criar = `denied`;
 * mudar um atendimento que a pessoa alcança = `not-allowed`). `onCheck`: o que um 23514 significa (a
 * regra de horário do gatilho: remarcar = `past`; mudar status = `too-early`).
 */
function toFailure(
  error: unknown,
  onPermission: AppointmentFailure,
  onCheck: AppointmentFailure,
): Extract<AppointmentResult, { ok: false }> {
  if (error instanceof Abort) return { ok: false, reason: error.reason };
  switch (pgErrorCode(error)) {
    case "23P01": // exclusão: sobreposição
      return {
        ok: false,
        reason: pgConstraintName(error) === "appointments_patient_no_overlap" ? "conflict-patient" : "conflict-professional",
      };
    case "42501":
      return { ok: false, reason: onPermission };
    case "23514":
      return { ok: false, reason: onCheck };
    case "23503": // chave estrangeira
    case "22021": // byte inválido no texto
    case "22P02": // texto inválido para o tipo
      return { ok: false, reason: "denied" };
    case "40P01": // deadlock
    case "40001": // falha de serialização
    case "55P03": // lock_timeout: a linha ficou presa por outra transação (pedido simultâneo)
      return { ok: false, reason: "busy" };
    default:
      // Erro inesperado (conexão...): não engolir, mas SEM a consulta e os parâmetros no log.
      throw withoutQueryDetails(error);
  }
}

/**
 * Executa o pedido e devolve o resultado. Um deadlock (40P01) entre duas reservas que entram ao mesmo
 * tempo nos índices de exclusão é refeito UMA vez: o pedido inteiro é uma transação sem efeito
 * externo, então repetir é seguro, e na repetição a que perdeu já enxerga a vencedora e devolve o
 * conflito de verdade (em vez de "sistema ocupado").
 */
export async function guarded<T extends { ok: boolean }>(
  run: () => Promise<T>,
  onPermission: AppointmentFailure,
  onCheck: AppointmentFailure,
): Promise<T | Extract<AppointmentResult, { ok: false }>> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      const failure = toFailure(error, onPermission, onCheck);
      if (!failure.ok && failure.reason === "busy" && attempt < 1) continue;
      return failure;
    }
  }
}

const slotFailure: Record<SlotReason, AppointmentFailure> = {
  invalid: "invalid-slot",
  "crosses-midnight": "invalid-slot",
  "outside-grid": "outside-grid",
  "time-off": "time-off",
};

/** Toma a trava COMPARTILHADA da agenda do profissional (a folga/semana nova, exclusiva, espera). */
export async function lockSchedule(tx: Tx, professionalId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock_shared(hashtextextended(${scheduleLockKey(professionalId)}, 0))`);
}

/** Confere o horário na grade e nas folgas do profissional (lidas dentro da trava). */
async function assertSlot(tx: Tx, professionalId: string, startsAt: Date, endsAt: Date): Promise<void> {
  const rows = await tx
    .select({ weekday: professionalWorkHours.weekday, start: professionalWorkHours.startMinute, end: professionalWorkHours.endMinute })
    .from(professionalWorkHours)
    .where(eq(professionalWorkHours.professionalId, professionalId));
  const timeOff = await tx
    .select({ startsAt: professionalTimeOff.startsAt, endsAt: professionalTimeOff.endsAt })
    .from(professionalTimeOff)
    .where(
      and(
        eq(professionalTimeOff.professionalId, professionalId),
        lt(professionalTimeOff.startsAt, endsAt),
        gt(professionalTimeOff.endsAt, startsAt),
      ),
    );
  const ranges: WorkRange[] = rows.map((row) => ({ weekday: row.weekday, start: row.start, end: row.end }));
  const result = checkSlot({ startsAt, endsAt, ranges, timeOff });
  if (!result.ok) throw new Abort(slotFailure[result.reason]);
}

/**
 * O valor a COPIAR do serviço: o do convênio do paciente (se ele tem convênio ativo e o serviço tem
 * valor para esse convênio), senão o particular; sem nenhum dos dois, sem valor.
 */
async function resolvePrice(
  tx: Tx,
  serviceId: string,
  patientId: string,
): Promise<{ priceCents: number; insuranceId: string | null } | null> {
  const [priv] = await tx
    .select({ insuranceId: patientPrivate.insuranceId })
    .from(patientPrivate)
    .where(eq(patientPrivate.patientId, patientId));
  let insuranceId: string | null = null;
  if (priv?.insuranceId) {
    const [insurance] = await tx
      .select({ id: insurances.id })
      .from(insurances)
      .where(and(eq(insurances.id, priv.insuranceId), isNull(insurances.deletedAt), eq(insurances.active, true)));
    insuranceId = insurance?.id ?? null;
  }
  const rows = await tx
    .select({ insuranceId: servicePrices.insuranceId, priceCents: servicePrices.priceCents })
    .from(servicePrices)
    .where(
      and(
        eq(servicePrices.serviceId, serviceId),
        isNull(servicePrices.deletedAt),
        insuranceId ? or(isNull(servicePrices.insuranceId), eq(servicePrices.insuranceId, insuranceId)) : isNull(servicePrices.insuranceId),
      ),
    );
  const chosen = (insuranceId && rows.find((row) => row.insuranceId === insuranceId)) || rows.find((row) => row.insuranceId === null);
  return chosen ? { priceCents: chosen.priceCents, insuranceId: chosen.insuranceId } : null;
}

/** O que uma reserva precisa saber antes de gravar (lido UMA vez e reaproveitado por cada sessão de uma série). */
export type BookingContext = {
  professionalId: string;
  patientId: string;
  serviceId: string;
  specialty: typeof professionals.$inferSelect.specialty;
  /** O valor a copiar do serviço (convênio do paciente, senão o particular, senão nenhum). */
  price: { priceCents: number; insuranceId: string | null } | null;
};

/**
 * Confere profissional ativo, serviço oferecido e ativo, e paciente (nesta ordem) e resolve o valor a
 * copiar. Devolve o contexto da reserva ou lança `Abort` (`not-found`, `service-not-offered`). Quem
 * chama já tomou a trava da agenda do profissional.
 */
export async function loadBookingContext(
  tx: Tx,
  input: { patientId: string; professionalId: string; serviceId: string },
  options: { price?: boolean } = {},
): Promise<BookingContext> {
  const [professional] = await tx
    .select({ id: professionals.id, specialty: professionals.specialty })
    .from(professionals)
    .where(and(eq(professionals.id, input.professionalId), isNull(professionals.deletedAt), eq(professionals.active, true)));
  if (!professional) throw new Abort("not-found");

  const [offered] = await tx
    .select({ serviceId: professionalServices.serviceId })
    .from(professionalServices)
    .innerJoin(services, eq(services.id, professionalServices.serviceId))
    .where(
      and(
        eq(professionalServices.professionalId, input.professionalId),
        eq(professionalServices.serviceId, input.serviceId),
        isNull(services.deletedAt),
        eq(services.active, true),
      ),
    );
  if (!offered) throw new Abort("service-not-offered");

  const [patient] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, input.patientId), isNull(patients.deletedAt)));
  if (!patient) throw new Abort("not-found");

  // A prévia só informa e não grava: dispensa a leitura do valor (3 idas ao banco a menos).
  const price = options.price === false ? null : await resolvePrice(tx, input.serviceId, input.patientId);
  return {
    professionalId: input.professionalId,
    patientId: input.patientId,
    serviceId: input.serviceId,
    specialty: professional.specialty,
    price,
  };
}

/**
 * Grava UM atendimento e o valor copiado (na mesma transação, como a RLS exige). `seriesId` liga a
 * sessão a uma série (nulo = avulso). O conflito de horário é decidido pelo BANCO: um 23P01 sobe.
 */
export async function insertOccurrence(
  tx: Tx,
  ctx: BookingContext,
  slot: { startsAt: Date; endsAt: Date },
  seriesId: string | null,
): Promise<string> {
  const [row] = await tx
    .insert(appointments)
    .values({
      seriesId,
      professionalId: ctx.professionalId,
      patientId: ctx.patientId,
      serviceId: ctx.serviceId,
      specialty: ctx.specialty,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
    })
    .returning({ id: appointments.id });
  if (!row) throw new Abort("denied");

  if (ctx.price) {
    await tx.insert(appointmentPrices).values({ appointmentId: row.id, priceCents: ctx.price.priceCents, insuranceId: ctx.price.insuranceId });
  }
  return row.id;
}

/** Garante o vínculo paciente↔profissional (o profissional passa a ver o cadastro básico). Idempotente. */
export async function linkPatient(tx: Tx, ctx: Pick<BookingContext, "patientId" | "professionalId">): Promise<void> {
  await tx.insert(patientProfessionals).values({ patientId: ctx.patientId, professionalId: ctx.professionalId }).onConflictDoNothing();
}

/**
 * Agenda um atendimento. Numa única transação: trava compartilhada da agenda do profissional → confere
 * profissional ativo, serviço oferecido e ativo, paciente → início não passado → grade e folgas →
 * resolve o valor → grava o atendimento, o valor e o VÍNCULO paciente↔profissional (se faltar). O
 * conflito de horário é decidido pelo BANCO (exclusão); um 23P01 desfaz tudo, inclusive o vínculo.
 * `now` é injetado para o teste não depender do relógio.
 */
export function createAppointment(
  user: AppointmentUser,
  input: { patientId: string; professionalId: string; serviceId: string; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): Promise<AppointmentResult> {
  return guarded(
    () =>
      withUser(user, async (tx): Promise<AppointmentResult> => {
        await lockSchedule(tx, input.professionalId);
        const ctx = await loadBookingContext(tx, input);

        if (input.startsAt.getTime() < now.getTime()) throw new Abort("past");
        await assertSlot(tx, input.professionalId, input.startsAt, input.endsAt);

        const id = await insertOccurrence(tx, ctx, input, null);
        await linkPatient(tx, ctx);
        return { ok: true, id };
      }),
    "denied",
    "denied",
  );
}

/**
 * Remarca (muda só o horário; o profissional e o serviço ficam). Volta para "Agendada". Confere a grade
 * e as folgas como ao criar; o conflito é do banco (a exclusão ignora a própria linha). Só atendimento
 * em aberto: o que já foi realizado, faltou ou foi cancelado devolve `changed`.
 */
export function rescheduleAppointment(
  user: AppointmentUser,
  input: { id: string; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): Promise<AppointmentResult> {
  return guarded(
    () =>
      withUser(user, async (tx): Promise<AppointmentResult> => {
        const [current] = await tx
          .select({
            professionalId: appointments.professionalId,
            status: appointments.status,
            startsAt: appointments.startsAt,
            endsAt: appointments.endsAt,
          })
          .from(appointments)
          .where(eq(appointments.id, input.id));
        if (!current) throw new Abort("not-found");
        if (!(OPEN as readonly string[]).includes(current.status)) throw new Abort("changed");
        // Mesmo horário: nada a mudar (e uma confirmada continua confirmada).
        if (current.startsAt.getTime() === input.startsAt.getTime() && current.endsAt.getTime() === input.endsAt.getTime()) {
          return { ok: true, id: input.id };
        }

        await lockSchedule(tx, current.professionalId);
        if (input.startsAt.getTime() < now.getTime()) throw new Abort("past");
        await assertSlot(tx, current.professionalId, input.startsAt, input.endsAt);

        const rows = await tx
          .update(appointments)
          .set({ startsAt: input.startsAt, endsAt: input.endsAt, status: "scheduled" })
          .where(and(eq(appointments.id, input.id), inArray(appointments.status, [...OPEN])))
          .returning({ id: appointments.id });
        if (!rows[0]) throw new Abort("changed");
        return { ok: true, id: rows[0].id };
      }),
    "not-allowed",
    "past",
  );
}

/** Cancela com motivo (o motivo é texto livre: nunca em log, URL ou erro). Só em aberto. */
export function cancelAppointment(user: AppointmentUser, input: { id: string; reason: string }): Promise<AppointmentResult> {
  return guarded(
    () =>
      withUser(user, async (tx): Promise<AppointmentResult> => {
        const rows = await tx
          .update(appointments)
          .set({ status: "cancelled", cancelReason: input.reason })
          .where(and(eq(appointments.id, input.id), inArray(appointments.status, [...OPEN])))
          .returning({ id: appointments.id });
        if (rows[0]) return { ok: true, id: rows[0].id };
        const [exists] = await tx.select({ id: appointments.id }).from(appointments).where(eq(appointments.id, input.id));
        throw new Abort(exists ? "changed" : "not-found");
      }),
    "not-allowed",
    "denied",
  );
}

/**
 * Muda o status (confirmar, Realizada ou Falta; cancelar tem função própria, com motivo). O mapa de
 * `src/lib/appointments/status.ts` decide ANTES (mensagem clara); o gatilho do banco é a última
 * barreira e concorda com ele. `role` é o papel da sessão, que a ação já conferiu.
 */
export function changeAppointmentStatus(
  user: AppointmentUser,
  input: { id: string; status: ChangeableStatus },
  role: ActorRole,
  now: Date = new Date(),
): Promise<AppointmentResult> {
  return guarded(
    () =>
      withUser(user, async (tx): Promise<AppointmentResult> => {
        const [current] = await tx
          .select({ status: appointments.status, startsAt: appointments.startsAt })
          .from(appointments)
          .where(eq(appointments.id, input.id));
        if (!current) throw new Abort("not-found");
        // Já está nesse status (alguém mudou antes, ou duplo clique): não é falta de permissão.
        if (current.status === input.status) throw new Abort("changed");

        const check = checkStatusChange({
          role,
          from: current.status as Parameters<typeof checkStatusChange>[0]["from"],
          to: input.status,
          startsAt: current.startsAt,
          now,
        });
        if (!check.ok) throw new Abort(check.reason);

        const rows = await tx
          .update(appointments)
          .set({ status: input.status })
          .where(and(eq(appointments.id, input.id), eq(appointments.status, current.status)))
          .returning({ id: appointments.id });
        if (!rows[0]) throw new Abort("changed");
        return { ok: true, id: rows[0].id };
      }),
    "not-allowed",
    "too-early",
  );
}
