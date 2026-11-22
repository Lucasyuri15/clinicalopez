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

import {
  cancelAppointment,
  changeAppointmentStatus,
  createAppointment,
  rescheduleAppointment,
  type AppointmentFailure,
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

const MESSAGES: Record<AppointmentFailure | "generic", string> = {
  generic: "Não foi possível concluir. Tente novamente.",
  "not-found": "Paciente, profissional ou atendimento não encontrado. Atualize a página e tente de novo.",
  "service-not-offered": "Este profissional não realiza o serviço escolhido.",
  past: "Esse horário já passou.",
  "invalid-slot": "Horário inválido. Use horários de 5 em 5 minutos, dentro de um mesmo dia.",
  "outside-grid": "Esse horário está fora do atendimento do profissional.",
  "time-off": "O profissional tem uma folga ou bloqueio nesse horário.",
  "conflict-professional": "O profissional já tem um atendimento nesse horário.",
  "conflict-patient": "O paciente já tem um atendimento nesse horário.",
  changed: "Este atendimento foi alterado por outra pessoa. Atualize a página.",
  "too-early": "Só é possível registrar Realizada ou Falta depois do início do atendimento.",
  "not-allowed": "Você não tem permissão para essa mudança.",
  denied: "Não foi possível salvar. Confira os dados e tente de novo.",
  busy: "O sistema estava ocupado. Tente de novo.",
};

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
  if (!result.ok) return { error: MESSAGES[result.reason], values };
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
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? MESSAGES.generic, values };
  return outcome(await createAppointment({ userId: staff.userId }, parsed.data), values);
}

export async function rescheduleAppointmentAction(
  _prevState: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const staff = await requireRole("admin", "reception");
  const values = pick(formData, RESCHEDULE_FIELDS);
  const parsed = rescheduleAppointmentSchema(new Date()).safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? MESSAGES.generic, values };
  return outcome(await rescheduleAppointment({ userId: staff.userId }, parsed.data), values);
}

export async function cancelAppointmentAction(
  _prevState: AppointmentFormState,
  formData: FormData,
): Promise<AppointmentFormState> {
  const staff = await requireRole("admin", "reception");
  const values = pick(formData, ["id", "reason"] as const);
  const parsed = cancelAppointmentSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? MESSAGES.generic, values };
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
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? MESSAGES.generic, values };
  return outcome(await changeAppointmentStatus({ userId: user.userId }, parsed.data, user.role), values);
}
