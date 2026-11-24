"use server";

import { revalidatePath } from "next/cache";

import { addendumSchema, finalizeNoteSchema, saveNoteSchema } from "@/lib/clinical/schemas";
import { requireRole } from "@/server/auth/session";

import { CLINICAL_MESSAGES } from "./messages";
import { addAddendum, type ClinicalResult, finalizeNote, saveNote } from "./mutations";

/**
 * Server Actions do prontuário (Fase 4A). Regras:
 * - TODAS começam com `requireRole("professional")`, antes de ler a entrada: só o profissional escreve
 *   (o admin só lê; a recepção nem isso). O `proxy` deixa passar o POST de uma ação: a proteção é
 *   daqui (`server-actions-guard.test.ts` confere).
 * - O usuário vem da SESSÃO, nunca do formulário; a entrada é validada no servidor (Zod).
 * - Mensagens fixas em pt-BR, nunca texto do banco nem o texto clínico digitado.
 * - Em ERRO devolvem também os valores digitados (o React limpa o formulário depois de cada ação e o
 *   profissional não pode perder o que escreveu).
 * DADO CLÍNICO SENSÍVEL: nada daqui é logado.
 */
export type ClinicalFormState = { error?: string; success?: true; values?: Record<string, string> } | undefined;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function pick<const Names extends readonly string[]>(formData: FormData, names: Names): Record<Names[number], string> {
  return Object.fromEntries(names.map((name) => [name, text(formData, name)])) as Record<Names[number], string>;
}

const fail = (message: string | undefined, values: Record<string, string>): ClinicalFormState => ({
  error: message ?? CLINICAL_MESSAGES.generic,
  values,
});

function outcome(result: ClinicalResult, values: Record<string, string>): ClinicalFormState {
  if (!result.ok) return fail(CLINICAL_MESSAGES[result.reason], values);
  revalidatePath("/pacientes/[id]", "page");
  return { success: true };
}

/** Salvar a evolução (cria o rascunho no 1º salvamento; depois atualiza o rascunho). */
export async function saveNoteAction(_prevState: ClinicalFormState, formData: FormData): Promise<ClinicalFormState> {
  const professional = await requireRole("professional");
  const values = pick(formData, ["appointmentId", "body"] as const);
  const parsed = saveNoteSchema().safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);
  return outcome(await saveNote({ userId: professional.userId }, parsed.data), values);
}

/** Finalizar: o texto fica trancado; depois só adendo. */
export async function finalizeNoteAction(_prevState: ClinicalFormState, formData: FormData): Promise<ClinicalFormState> {
  const professional = await requireRole("professional");
  const values = pick(formData, ["noteId"] as const);
  const parsed = finalizeNoteSchema().safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);
  return outcome(await finalizeNote({ userId: professional.userId }, parsed.data), values);
}

/** Adicionar um adendo a uma evolução finalizada. */
export async function addAddendumAction(_prevState: ClinicalFormState, formData: FormData): Promise<ClinicalFormState> {
  const professional = await requireRole("professional");
  const values = pick(formData, ["noteId", "body"] as const);
  const parsed = addendumSchema().safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);
  return outcome(await addAddendum({ userId: professional.userId }, parsed.data), values);
}
