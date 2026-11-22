/**
 * Status de um atendimento e quem pode mudar de um para outro (Fase 2, agenda). PURO.
 *
 * Este mapa é espelhado pelo gatilho `BEFORE UPDATE` do banco (migração da agenda), que é a última
 * barreira; um teste de dados percorre todos os pares para provar que os dois concordam. Mudou
 * aqui, muda lá.
 *
 * Regras:
 *  - admin e recepção: Agendada → Confirmada, Realizada, Falta ou Cancelada; Confirmada → Realizada,
 *    Falta ou Cancelada;
 *  - o profissional: só Agendada/Confirmada → Realizada ou Falta (confirmar e cancelar é da recepção);
 *  - SÓ o admin corrige Realizada ↔ Falta;
 *  - Cancelada é terminal para todos; "mudar" para o mesmo status não é transição;
 *  - Realizada e Falta só valem depois do início do atendimento.
 * Remarcar (trocar o horário) não é uma transição daqui: é outra operação, que devolve o
 * atendimento para "Agendada".
 */
export const APPOINTMENT_STATUSES = ["scheduled", "confirmed", "done", "no_show", "cancelled"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export type ActorRole = "admin" | "reception" | "professional";

/**
 * A EQUIPE (admin e recepção): a única que recebe o motivo do cancelamento e o aviso de consentimento.
 * Lista explícita (e não "diferente de profissional"): um papel novo nasce SEM ver esses dados.
 */
export const isStaffRole = (role: ActorRole): boolean => role === "admin" || role === "reception";

export type StatusChangeResult = { ok: true } | { ok: false; reason: "not-allowed" | "too-early" };

const STAFF_OPEN: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ["confirmed", "done", "no_show", "cancelled"],
  confirmed: ["done", "no_show", "cancelled"],
  done: [],
  no_show: [],
  cancelled: [],
};

const ADMIN_CORRECTIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  ...STAFF_OPEN,
  done: ["no_show"],
  no_show: ["done"],
};

const PROFESSIONAL: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  scheduled: ["done", "no_show"],
  confirmed: ["done", "no_show"],
  done: [],
  no_show: [],
  cancelled: [],
};

const MAP: Record<ActorRole, Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  admin: ADMIN_CORRECTIONS,
  reception: STAFF_OPEN,
  professional: PROFESSIONAL,
};

/** Para quais status `role` pode levar um atendimento que está em `from` (sem a regra do horário). */
export function allowedTransitions(role: ActorRole, from: AppointmentStatus): readonly AppointmentStatus[] {
  return MAP[role][from];
}

const NEEDS_STARTED = new Set<AppointmentStatus>(["done", "no_show"]);

/**
 * Decide se `role` pode mudar o atendimento de `from` para `to`. `not-allowed` vem antes de
 * `too-early`. Realizada/Falta exigem `startsAt <= now`.
 */
export function checkStatusChange(input: {
  role: ActorRole;
  from: AppointmentStatus;
  to: AppointmentStatus;
  startsAt: Date;
  now: Date;
}): StatusChangeResult {
  if (!MAP[input.role][input.from].includes(input.to)) return { ok: false, reason: "not-allowed" };
  if (NEEDS_STARTED.has(input.to) && input.startsAt.getTime() > input.now.getTime()) {
    return { ok: false, reason: "too-early" };
  }
  return { ok: true };
}

/** Só a Cancelada libera o horário; Realizada e Falta continuam ocupando (o histórico é verdadeiro). */
export function blocksSlot(status: AppointmentStatus): boolean {
  return status !== "cancelled";
}
