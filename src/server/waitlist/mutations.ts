import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { pgErrorCode, withoutQueryDetails } from "@/server/db/pg-error";
import { patients, professionalServices, professionals, services, waitlistEntries } from "@/server/db/schema";
import { withUser, type Tx } from "@/server/db/with-user";

import type { WaitlistUser } from "./queries";

/**
 * Gravações da lista de espera (Fase 3B), sempre por `withUser` (a RLS decide quem grava; a camada de
 * ações ainda exige admin ou recepção). O resultado é um VALOR, não uma exceção: o erro do banco nunca
 * sobe para a tela (nem o texto dele, que poderia trazer dado de paciente ou a nota). Cada pedido é
 * uma transação.
 *
 *  - `not-found`: paciente, serviço, profissional (ativo) ou a espera não existe, foi removido ou a
 *    RLS o esconde;
 *  - `service-not-offered`: o profissional pedido não oferece o serviço;
 *  - `duplicate`: já há uma espera ABERTA para esse paciente + serviço + profissional;
 *  - `changed`: a espera já foi encerrada (outra pessoa atendeu ou tirou antes);
 *  - `denied`: o banco recusou (sem permissão, preferência inválida...); `busy`: deadlock ou
 *    serialização, é só tentar de novo.
 */
export type WaitlistFailure = "not-found" | "service-not-offered" | "duplicate" | "changed" | "denied" | "busy";

export type WaitlistResult = { ok: true; id: string } | { ok: false; reason: WaitlistFailure };

/** O que a pessoa informa sobre o que prefere (já validado por `src/lib/waitlist/schemas.ts`). */
export type WaitlistPreferenceInput = {
  professionalId: string | null;
  weekdays: number[];
  startMinute: number | null;
  endMinute: number | null;
  note: string | null;
};

export type AddEntryInput = WaitlistPreferenceInput & { patientId: string; serviceId: string };
export type UpdateEntryInput = WaitlistPreferenceInput & { id: string };

/** Lançada dentro da transação para DESFAZÊ-LA e devolver um resultado já conhecido. */
class Abort extends Error {
  constructor(readonly reason: WaitlistFailure) {
    super(reason);
  }
}

function toFailure(error: unknown): Extract<WaitlistResult, { ok: false }> {
  if (error instanceof Abort) return { ok: false, reason: error.reason };
  switch (pgErrorCode(error)) {
    case "23505": // o índice único da espera aberta
      return { ok: false, reason: "duplicate" };
    case "42501": // RLS ou gatilho
    case "23503": // chave estrangeira (especialidade diferente...)
    case "23514": // CHECK da preferência
    case "22021": // byte inválido no texto
    case "22P02": // texto inválido para o tipo
      return { ok: false, reason: "denied" };
    case "40P01": // deadlock
    case "40001": // falha de serialização
    case "55P03": // lock_timeout
      return { ok: false, reason: "busy" };
    default:
      // Erro inesperado (conexão...): não engolir, mas SEM a consulta e os parâmetros no log.
      throw withoutQueryDetails(error);
  }
}

async function run(user: WaitlistUser, body: (tx: Tx) => Promise<string>): Promise<WaitlistResult> {
  try {
    return { ok: true, id: await withUser(user, body) };
  } catch (error) {
    return toFailure(error);
  }
}

/** O profissional existe, está ativo e não removido e OFERECE o serviço; senão aborta. */
async function assertOffers(tx: Tx, professionalId: string, serviceId: string): Promise<void> {
  const [professional] = await tx
    .select({ id: professionals.id })
    .from(professionals)
    .where(and(eq(professionals.id, professionalId), isNull(professionals.deletedAt), eq(professionals.active, true)));
  if (!professional) throw new Abort("not-found");
  const [offered] = await tx
    .select({ serviceId: professionalServices.serviceId })
    .from(professionalServices)
    .where(and(eq(professionalServices.professionalId, professionalId), eq(professionalServices.serviceId, serviceId)));
  if (!offered) throw new Abort("service-not-offered");
}

/** A espera aberta (a RLS esconde o que a pessoa não alcança); senão aborta com `not-found` ou `changed`. */
async function loadOpen(tx: Tx, id: string): Promise<{ serviceId: string; professionalId: string | null }> {
  const [entry] = await tx
    .select({ serviceId: waitlistEntries.serviceId, professionalId: waitlistEntries.professionalId, status: waitlistEntries.status })
    .from(waitlistEntries)
    .where(eq(waitlistEntries.id, id));
  if (!entry) throw new Abort("not-found");
  if (entry.status !== "waiting") throw new Abort("changed");
  return { serviceId: entry.serviceId, professionalId: entry.professionalId };
}

/**
 * Põe alguém na espera. Confere serviço ativo, paciente não removido e, se houver, profissional ativo
 * que oferece o serviço (a oferta é do servidor, como em `appointments`). A especialidade vem do
 * serviço; o banco garante que o profissional é da mesma.
 */
export function addEntry(user: WaitlistUser, input: AddEntryInput): Promise<WaitlistResult> {
  return run(user, async (tx) => {
    const [service] = await tx
      .select({ id: services.id, specialty: services.specialty })
      .from(services)
      .where(and(eq(services.id, input.serviceId), isNull(services.deletedAt), eq(services.active, true)));
    if (!service) throw new Abort("not-found");
    const [patient] = await tx
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.id, input.patientId), isNull(patients.deletedAt)));
    if (!patient) throw new Abort("not-found");
    if (input.professionalId) await assertOffers(tx, input.professionalId, service.id);

    const [row] = await tx
      .insert(waitlistEntries)
      .values({
        patientId: input.patientId,
        serviceId: service.id,
        specialty: service.specialty,
        professionalId: input.professionalId,
        weekdays: input.weekdays,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        note: input.note,
      })
      .returning({ id: waitlistEntries.id });
    if (!row) throw new Abort("denied");
    return row.id;
  });
}

/** Edita só a preferência de uma espera aberta (paciente e serviço não mudam). */
export function updateEntry(user: WaitlistUser, input: UpdateEntryInput): Promise<WaitlistResult> {
  return run(user, async (tx) => {
    const current = await loadOpen(tx, input.id);
    // Só um profissional NOVO precisa estar ativo e oferecer o serviço: manter o que já estava (mesmo
    // desativado depois) não pode travar a edição de dias, faixa e nota.
    if (input.professionalId && input.professionalId !== current.professionalId) {
      await assertOffers(tx, input.professionalId, current.serviceId);
    }
    const rows = await tx
      .update(waitlistEntries)
      .set({
        professionalId: input.professionalId,
        weekdays: input.weekdays,
        startMinute: input.startMinute,
        endMinute: input.endMinute,
        note: input.note,
      })
      .where(and(eq(waitlistEntries.id, input.id), eq(waitlistEntries.status, "waiting")))
      .returning({ id: waitlistEntries.id });
    if (!rows[0]) throw new Abort("changed");
    return rows[0].id;
  });
}

/** Tira da espera (só uma aberta). Quem tirou e quando vêm do gatilho do banco. */
export function removeEntry(user: WaitlistUser, input: { id: string }): Promise<WaitlistResult> {
  return run(user, async (tx) => {
    await loadOpen(tx, input.id);
    const rows = await tx
      .update(waitlistEntries)
      .set({ status: "removed" })
      .where(and(eq(waitlistEntries.id, input.id), eq(waitlistEntries.status, "waiting")))
      .returning({ id: waitlistEntries.id });
    if (!rows[0]) throw new Abort("changed");
    return rows[0].id;
  });
}
