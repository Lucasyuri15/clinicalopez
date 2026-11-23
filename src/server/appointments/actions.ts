"use server";

import { revalidatePath } from "next/cache";

import {
  cancelAppointmentSchema,
  createAppointmentSchema,
  rescheduleAppointmentSchema,
  statusChangeSchema,
} from "@/lib/appointments/schemas";
import { requireRole } from "@/server/auth/session";
import type { CatalogFormState } from "@/server/catalog/actions";

import { FAILURE_MESSAGES } from "./messages";
import {
  cancelAppointment,
  changeAppointmentStatus,
  createAppointment,
  rescheduleAppointment,
  type AppointmentResult,
} from "./mutations";

/**
 * Server Actions da agenda. Regras:
 * - TODAS começam com `requireRole(...)`, antes de ler a entrada: admin e recepção agendam, remarcam e
 *   cancelam; o profissional só muda o status dos PRÓPRIOS atendimentos (Realizada ou Falta). O `proxy`
 *   deixa passar o POST de uma ação: a proteção é daqui (`server-actions-guard.test.ts` confere).
 * - O usuário e o PAPEL vêm da SESSÃO, nunca do formulário.
 * - Entrada validada com Zod (`src/lib/appointments/schemas.ts`); mensagens fixas em pt-BR, nunca texto
 *   do banco nem o motivo digitado no cancelamento (texto livre).
 * - Em ERRO devolvem também os valores digitados (o React limpa o formulário depois de cada ação).
 * DADO SENSÍVEL: nada daqui é logado.
 */
export type AppointmentFormState = CatalogFormState;


function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function pick<const Names extends readonly string[]>(formData: FormData, names: Names): Record<Names[number], string> {
  return Object.fromEntries(names.map((name) => [name, text(formData, name)])) as Record<Names[number], string>;
}

function revalidateAgenda() {
  revalidatePath("/agenda");
  // Agendar pode criar o vínculo paciente↔profissional: a ficha do paciente muda.
  revalidatePath("/pacientes/[id]", "page");
}

function outcome(result: AppointmentResult, values: Record<string, string>): AppointmentFormState {
  if (!result.ok) return { error: FAILURE_MESSAGES[result.reason], values };
  revalidateAgenda();
  return { success: true };
}

const CREATE_FIELDS = ["patientId", "professionalId", "serviceId", "date", "startTime", "durationMinutes"] as const;
const RESCHEDULE_FIELDS = ["id", "date", "startTime", "durationMinutes"] as const;

export async function createAppointmentAction(
  _prevState: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const staff = await requireRole("admin", "reception");
  const values = pick(formData, CREATE_FIELDS);
  const parsed = createAppointmentSchema(new Date()).safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? FAILURE_MESSAGES.generic, values };
  return outcome(await createAppointment({ userId: staff.userId }, parsed.data), values);
}

export async function rescheduleAppointmentAction(
  _prevState: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const staff = await requireRole("admin", "reception");
  const values = pick(formData, RESCHEDULE_FIELDS);
  const parsed = rescheduleAppointmentSchema(new Date()).safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? FAILURE_MESSAGES.generic, values };
  return outcome(await rescheduleAppointment({ userId: staff.userId }, parsed.data), values);
}

export async function cancelAppointmentAction(
  _prevState: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const staff = await requireRole("admin", "reception");
  const values = pick(formData, ["id", "reason"] as const);
  const parsed = cancelAppointmentSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? FAILURE_MESSAGES.generic, values };
  return outcome(await cancelAppointment({ userId: staff.userId }, parsed.data), values);
}

/** Confirmar, Realizada ou Falta. O papel que decide o mapa de status vem da sessão. */
export async function changeStatusAction(
  _prevState: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const user = await requireRole("admin", "reception", "professional");
  const values = pick(formData, ["id", "status"] as const);
  const parsed = statusChangeSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? FAILURE_MESSAGES.generic, values };
  return outcome(await changeAppointmentStatus({ userId: user.userId }, parsed.data, user.role), values);
}
