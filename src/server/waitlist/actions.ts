"use server";

import { revalidatePath } from "next/cache";

import { addWaitlistSchema, removeWaitlistSchema, updateWaitlistSchema } from "@/lib/waitlist/schemas";
import { requireRole } from "@/server/auth/session";

import { WAITLIST_MESSAGES } from "./messages";
import { addEntry, removeEntry, updateEntry, type WaitlistResult } from "./mutations";

/**
 * Server Actions da lista de espera (Fase 3B). Regras:
 * - TODAS começam com `requireRole("admin", "reception")`, antes de ler a entrada: a espera é gestão da
 *   recepção, o profissional nunca a vê nem a muda. O `proxy` deixa passar o POST de uma ação: a
 *   proteção é daqui (`server-actions-guard.test.ts` confere).
 * - O usuário vem da SESSÃO, nunca do formulário; a entrada é validada no servidor (Zod).
 * - Mensagens fixas em pt-BR, nunca texto do banco nem a nota digitada (texto livre).
 * - Em ERRO devolvem também os valores digitados (o React limpa o formulário depois de cada ação).
 * DADO SENSÍVEL: nada daqui é logado.
 */
export type WaitlistFormState = { error?: string; success?: true; values?: Record<string, string> } | undefined;

const ADD_FIELDS = ["patientId", "serviceId", "professionalId", "startTime", "endTime", "note"] as const;
const UPDATE_FIELDS = ["id", "professionalId", "startTime", "endTime", "note"] as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function pick<const Names extends readonly string[]>(formData: FormData, names: Names): Record<Names[number], string> {
  return Object.fromEntries(names.map((name) => [name, text(formData, name)])) as Record<Names[number], string>;
}

/** Os dias da semana marcados (várias caixas com o mesmo nome) como lista de textos. */
const weekdaysOf = (formData: FormData): string[] =>
  formData.getAll("weekdays").filter((value): value is string => typeof value === "string");

/** Os valores digitados devolvidos em caso de erro (os dias voltam juntos, separados por vírgula). */
const echo = (formData: FormData, names: readonly string[]): Record<string, string> => ({
  ...pick(formData, names),
  weekdays: weekdaysOf(formData).join(","),
});

const fail = (message: string | undefined, values: Record<string, string>): WaitlistFormState => ({
  error: message ?? WAITLIST_MESSAGES.generic,
  values,
});

function outcome(result: WaitlistResult, values: Record<string, string>): WaitlistFormState {
  if (!result.ok) return fail(WAITLIST_MESSAGES[result.reason], values);
  revalidatePath("/lista-espera");
  return { success: true };
}

/** Pôr alguém na espera. */
export async function addWaitlistAction(_prevState: WaitlistFormState, formData: FormData): Promise<WaitlistFormState> {
  const staff = await requireRole("admin", "reception");
  const values = echo(formData, ADD_FIELDS);
  const parsed = addWaitlistSchema().safeParse({ ...pick(formData, ADD_FIELDS), weekdays: weekdaysOf(formData) });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);
  return outcome(await addEntry({ userId: staff.userId }, parsed.data), values);
}

/** Editar a preferência de uma espera aberta (paciente e serviço não mudam). */
export async function updateWaitlistAction(_prevState: WaitlistFormState, formData: FormData): Promise<WaitlistFormState> {
  const staff = await requireRole("admin", "reception");
  const values = echo(formData, UPDATE_FIELDS);
  const parsed = updateWaitlistSchema().safeParse({ ...pick(formData, UPDATE_FIELDS), weekdays: weekdaysOf(formData) });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);
  return outcome(await updateEntry({ userId: staff.userId }, parsed.data), values);
}

/** Tirar da espera. */
export async function removeWaitlistAction(_prevState: WaitlistFormState, formData: FormData): Promise<WaitlistFormState> {
  const staff = await requireRole("admin", "reception");
  const values = pick(formData, ["id"] as const);
  const parsed = removeWaitlistSchema().safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);
  return outcome(await removeEntry({ userId: staff.userId }, parsed.data), values);
}
