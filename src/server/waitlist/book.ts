import "server-only";

import { and, eq } from "drizzle-orm";

import {
  Abort,
  assertSlot,
  guarded,
  insertOccurrence,
  linkPatient,
  loadBookingContext,
  lockSchedule,
  type AppointmentResult,
} from "@/server/appointments/mutations";
import type { AppointmentUser } from "@/server/appointments/queries";
import { services, waitlistEntries } from "@/server/db/schema";
import { withUser } from "@/server/db/with-user";

const MINUTE_MS = 60_000;

/**
 * Agenda a partir da lista de espera (Fase 3B-2): o agendamento comum, mais fechar a espera. UMA
 * transação (atendimento, valor, vínculo e espera `fulfilled` juntos ou nada): trava compartilhada da
 * agenda do profissional → a espera está aberta e este profissional serve ao pedido → profissional,
 * serviço e paciente → início não passado → grade e folga → grava → fecha a espera com
 * `WHERE status = 'waiting'` (se outra pessoa a fechou antes, `changed` desfaz o atendimento).
 *
 * O pedido traz só o início e o profissional do horário que vagou: o paciente, o serviço e a DURAÇÃO
 * vêm da espera e do serviço, lidos aqui (o que a tela mostrou como candidato não é confiável). O
 * conflito de horário continua sendo da exclusão do banco. `now` é injetado para o teste.
 */
export function bookFromWaitlist(
  user: AppointmentUser,
  input: { entryId: string; professionalId: string; startsAt: Date },
  now: Date = new Date(),
): Promise<AppointmentResult> {
  return guarded(
    () =>
      withUser(user, async (tx): Promise<AppointmentResult> => {
        await lockSchedule(tx, input.professionalId);

        const [entry] = await tx
          .select({
            patientId: waitlistEntries.patientId,
            serviceId: waitlistEntries.serviceId,
            professionalId: waitlistEntries.professionalId,
            status: waitlistEntries.status,
          })
          .from(waitlistEntries)
          .where(eq(waitlistEntries.id, input.entryId));
        if (!entry) throw new Abort("not-found");
        if (entry.status !== "waiting") throw new Abort("changed");
        // Quem pediu um profissional só é atendido por ele; "qualquer" aceita quem ofereça o serviço.
        if (entry.professionalId && entry.professionalId !== input.professionalId) throw new Abort("not-found");

        const ctx = await loadBookingContext(tx, {
          patientId: entry.patientId,
          professionalId: input.professionalId,
          serviceId: entry.serviceId,
        });
        const [service] = await tx.select({ durationMinutes: services.durationMinutes }).from(services).where(eq(services.id, entry.serviceId));
        if (!service) throw new Abort("not-found");

        const startsAt = input.startsAt;
        const endsAt = new Date(startsAt.getTime() + service.durationMinutes * MINUTE_MS);
        if (startsAt.getTime() < now.getTime()) throw new Abort("past");
        await assertSlot(tx, input.professionalId, startsAt, endsAt);

        const id = await insertOccurrence(tx, ctx, { startsAt, endsAt }, null);
        await linkPatient(tx, ctx);

        const closed = await tx
          .update(waitlistEntries)
          .set({ status: "fulfilled", appointmentId: id })
          .where(and(eq(waitlistEntries.id, input.entryId), eq(waitlistEntries.status, "waiting")))
          .returning({ id: waitlistEntries.id });
        if (!closed[0]) throw new Abort("changed");
        return { ok: true, id };
      }),
    "denied",
    "denied",
  );
}
