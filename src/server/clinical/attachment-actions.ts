"use server";

import { revalidatePath } from "next/cache";

import { ATTACHMENT_MAX_BYTES } from "@/lib/attachments/files";
import { removeAttachmentSchema, uploadAttachmentSchema } from "@/lib/attachments/schemas";
import { requireRole } from "@/server/auth/session";
import { getAttachmentStore } from "@/server/storage";

import { type AttachmentResult, removeAttachment, uploadAttachment } from "./attachments";
import { ATTACHMENT_MESSAGES } from "./messages";

/**
 * Server Actions dos anexos clínicos (Fase 4B-1). Regras:
 * - TODAS começam com `requireRole("professional")`, antes de ler a entrada: só o profissional anexa e
 *   remove (o admin só lê; a recepção nem isso). O `proxy` deixa passar o POST de uma ação: a proteção
 *   é daqui (`server-actions-guard.test.ts` confere).
 * - O usuário vem da SESSÃO, nunca do formulário; os ids são validados no servidor (Zod) e o arquivo é
 *   conferido pelos BYTES (`validateFile`, na camada de dados), nunca pelo nome ou tipo que o navegador diz.
 * - O tamanho é conferido ANTES de ler o arquivo para a memória.
 * - Mensagens fixas em pt-BR; em ERRO devolvem só os ids digitados (o arquivo nunca volta).
 * DADO CLÍNICO SENSÍVEL: nada daqui é logado, nem o nome do arquivo.
 */
export type AttachmentFormState = { error?: string; success?: true; values?: Record<string, string> } | undefined;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

const fail = (message: string | undefined, values: Record<string, string>): AttachmentFormState => ({
  error: message ?? ATTACHMENT_MESSAGES.generic,
  values,
});

function outcome(result: AttachmentResult, values: Record<string, string>): AttachmentFormState {
  if (!result.ok) return fail(ATTACHMENT_MESSAGES[result.reason], values);
  revalidatePath("/pacientes/[id]", "page");
  return { success: true };
}

/** Anexar um arquivo ao paciente (com atendimento Realizado opcional). */
export async function uploadAttachmentAction(_prevState: AttachmentFormState, formData: FormData): Promise<AttachmentFormState> {
  const professional = await requireRole("professional");
  const values = { patientId: text(formData, "patientId"), appointmentId: text(formData, "appointmentId") };
  const parsed = uploadAttachmentSchema().safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);

  const file = formData.get("file");
  if (!(file instanceof File) || (file.size === 0 && file.name === "")) return fail(ATTACHMENT_MESSAGES["no-file"], values);
  if (file.size === 0) return fail(ATTACHMENT_MESSAGES.empty, values);
  if (file.size > ATTACHMENT_MAX_BYTES) return fail(ATTACHMENT_MESSAGES["too-large"], values);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadAttachment({ userId: professional.userId }, { ...parsed.data, name: file.name, bytes }, await getAttachmentStore());
  return outcome(result, values);
}

/** Remover (lógico) um anexo do próprio autor. */
export async function removeAttachmentAction(_prevState: AttachmentFormState, formData: FormData): Promise<AttachmentFormState> {
  const professional = await requireRole("professional");
  const values = { attachmentId: text(formData, "attachmentId") };
  const parsed = removeAttachmentSchema().safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);
  return outcome(await removeAttachment({ userId: professional.userId }, parsed.data), values);
}
