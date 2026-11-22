"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ID_MESSAGE } from "@/lib/catalog/schemas";
import { timeOffInputSchema, weekInputSchema } from "@/lib/schedule/schemas";
import { requireRole } from "@/server/auth/session";
import type { CatalogFormState } from "@/server/catalog/actions";

import { addTimeOff, removeTimeOff, saveWeek, type ScheduleResult } from "./mutations";

/**
 * Server Actions da grade de horários. Regras:
 * - TODAS começam com `requireRole("admin", "reception")`, antes de ler a entrada: a recepção opera a
 *   grade no dia a dia; o PROFISSIONAL só lê a própria (o `proxy` deixa passar o POST de uma ação: a
 *   proteção é daqui; `server-actions-guard.test.ts` confere). O usuário vem sempre da SESSÃO.
 * - Entrada validada com Zod (`src/lib/schedule/schemas.ts`); mensagens fixas em pt-BR, nunca
 *   texto do banco.
 * - Em ERRO devolvem também o que foi digitado (`values`): o React limpa o formulário depois de
 *   cada ação, e a tela usa estes valores como valor inicial dos campos.
 */
export type ScheduleFormState = CatalogFormState;

const MESSAGES = {
  generic: "Não foi possível concluir. Tente novamente.",
  notFound: "Profissional não encontrado. Atualize a página e tente de novo.",
  denied: "Não foi possível salvar. Atualize a página e tente de novo.",
  overlap: "Não foi possível salvar: há faixas que se sobrepõem. Confira os horários e tente de novo.",
} as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failureMessage(result: Extract<ScheduleResult, { ok: false }>): string {
  switch (result.reason) {
    case "overlap":
      return MESSAGES.overlap;
    case "not-found":
      return MESSAGES.notFound;
    case "denied":
      return MESSAGES.denied;
  }
}

/** A grade aparece só em `/profissionais/[id]/horarios`: atualiza o padrão da rota (todos os ids). */
function revalidateSchedule() {
  revalidatePath("/profissionais/[id]/horarios", "page");
}

export async function saveWeekAction(
  _prevState: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  const staff = await requireRole("admin", "reception");
  const values = { ranges: text(formData, "ranges") };
  const parsed = weekInputSchema.safeParse({ professionalId: text(formData, "professionalId"), ...values });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? MESSAGES.generic, values };

  const result = await saveWeek({ userId: staff.userId }, parsed.data);
  if (!result.ok) return { error: failureMessage(result), values };

  revalidateSchedule();
  return { success: true };
}

export async function addTimeOffAction(
  _prevState: ScheduleFormState,
  formData: FormData,
): Promise<ScheduleFormState> {
  const staff = await requireRole("admin", "reception");
  const values = {
    startDate: text(formData, "startDate"),
    endDate: text(formData, "endDate"),
    allDay: text(formData, "allDay"),
    startTime: text(formData, "startTime"),
    endTime: text(formData, "endTime"),
    reason: text(formData, "reason"),
  };
  const parsed = timeOffInputSchema.safeParse({ professionalId: text(formData, "professionalId"), ...values });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? MESSAGES.generic, values };

  const result = await addTimeOff({ userId: staff.userId }, parsed.data);
  if (!result.ok) return { error: failureMessage(result), values };

  revalidateSchedule();
  return { success: true };
}

export async function removeTimeOffAction(formData: FormData): Promise<void> {
  const staff = await requireRole("admin", "reception");
  const parsed = z.guid({ error: ID_MESSAGE }).safeParse(text(formData, "id"));
  if (!parsed.success) return;
  await removeTimeOff({ userId: staff.userId }, parsed.data);
  // Atualiza a tela mesmo se o banco recusou (ex.: outra pessoa removeu antes): mostra o estado real.
  revalidateSchedule();
}
