import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { type AttachmentType, displayName, validateFile } from "@/lib/attachments/files";
import { pgErrorCode, withoutQueryDetails } from "@/server/db/pg-error";
import { appointments, clinicalAttachments, patients, type UserRole } from "@/server/db/schema";
import { withUser, type Tx } from "@/server/db/with-user";
import type { AttachmentStore } from "@/server/storage/types";

import { recordAccess } from "./access-log";
import { Abort, authorOf } from "./author";

/**
 * Anexos clínicos (Fase 4B-1): enviar, abrir e remover, sempre por `withUser` (RLS e gatilhos
 * decidem; a camada de ações ainda exige o papel certo). Resultados são VALORES, nunca o erro do banco
 * nem a mensagem do Storage. Cada pedido é uma transação e grava o log de acesso junto (falha fechada).
 * O arquivo só é entregue DEPOIS de o log estar gravado. DADO CLÍNICO SENSÍVEL: nem o nome do arquivo
 * nem os bytes vão a log, URL ou erro.
 *
 *  - `empty` / `too-large` / `bad-type`: o arquivo (vazio, acima de 4 MiB, tipo não permitido pelos bytes);
 *  - `not-found`: paciente, atendimento ou anexo não existe ou a RLS o esconde (inclusive o de outro
 *    profissional: quem não enxerga, "não existe");
 *  - `not-realized`: o atendimento informado não está Realizado;
 *  - `duplicate`: o mesmo arquivo já está anexado a este paciente por este autor;
 *  - `denied`: o banco recusou ou o login não é de um profissional;
 *  - `busy`: deadlock ou serialização; é só tentar de novo;
 *  - `unavailable`: o Storage falhou.
 */
export type AttachmentFailure =
  | "empty"
  | "too-large"
  | "bad-type"
  | "not-found"
  | "not-realized"
  | "duplicate"
  | "denied"
  | "busy"
  | "unavailable";

export type AttachmentResult = { ok: true; attachmentId: string } | { ok: false; reason: AttachmentFailure };

export type OpenedFile = { bytes: Uint8Array; contentType: AttachmentType; name: string };
export type OpenResult = { ok: true; file: OpenedFile } | { ok: false; reason: "not-found" | "unavailable" };

export type AttachmentWriter = { userId: string };
export type AttachmentReader = { userId: string; role: UserRole };

function toFailure(error: unknown): Extract<AttachmentResult, { ok: false }> {
  if (error instanceof Abort) return { ok: false, reason: error.reason as AttachmentFailure };
  switch (pgErrorCode(error)) {
    case "23505": // o mesmo arquivo (mesmo conteúdo) já está anexado a este paciente por este autor
      return { ok: false, reason: "duplicate" };
    case "40P01": // deadlock
    case "40001": // falha de serialização
    case "55P03": // lock_timeout
      return { ok: false, reason: "busy" };
    case "42501": // RLS ou gatilho
    case "23503": // chave estrangeira
    case "23514": // CHECK
    case "22021": // byte inválido
    case "22P02": // valor inválido para o tipo
      return { ok: false, reason: "denied" };
    default:
      // Erro inesperado (conexão...): não engolir, mas SEM a consulta e os parâmetros no log.
      throw withoutQueryDetails(error);
  }
}

const isUuid = (value: string) => z.guid().safeParse(value).success;

/** Antes de gravar no Storage: o paciente é visível e, se houver atendimento, é Realizado, dele e do paciente. */
async function ensureTarget(tx: Tx, professionalId: string, patientId: string, appointmentId: string | null) {
  const [patient] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.id, patientId)).limit(1);
  if (!patient) throw new Abort("not-found");
  if (appointmentId === null) return;
  const [appointment] = await tx
    .select({ patientId: appointments.patientId, professionalId: appointments.professionalId, status: appointments.status })
    .from(appointments)
    .where(eq(appointments.id, appointmentId))
    .limit(1);
  if (!appointment || appointment.professionalId !== professionalId || appointment.patientId !== patientId) throw new Abort("not-found");
  if (appointment.status !== "done") throw new Abort("not-realized");
}

/**
 * Enviar: confere o arquivo pelos bytes, confere o alvo, grava no Storage (nome = UUID, sem dado
 * pessoal) e só então registra a linha e o log na MESMA transação. Se o banco recusar depois de o
 * arquivo estar no Storage, o envio órfão é desfeito (melhor esforço).
 */
export async function uploadAttachment(
  user: AttachmentWriter,
  input: { patientId: string; appointmentId: string | null; name: string; bytes: Uint8Array },
  store: AttachmentStore,
): Promise<AttachmentResult> {
  const check = validateFile(input.bytes);
  if (!check.ok) return { ok: false, reason: check.reason };

  try {
    await withUser(user, async (tx) => ensureTarget(tx, await authorOf(tx, user.userId), input.patientId, input.appointmentId));
  } catch (error) {
    return toFailure(error);
  }

  const path = randomUUID();
  const put = await store.put(path, input.bytes, check.contentType);
  if (!put.ok) return { ok: false, reason: put.reason === "rejected" ? "denied" : "unavailable" };

  try {
    const attachmentId = await withUser(user, async (tx) => {
      const professionalId = await authorOf(tx, user.userId);
      const [created] = await tx
        .insert(clinicalAttachments)
        .values({
          patientId: input.patientId,
          professionalId,
          appointmentId: input.appointmentId,
          storagePath: path,
          originalName: displayName(input.name, check.contentType),
          contentType: check.contentType,
          sizeBytes: input.bytes.length,
          sha256: createHash("sha256").update(input.bytes).digest("hex"),
        })
        .returning({ id: clinicalAttachments.id });
      await recordAccess(tx, { action: "upload_attachment", patientId: input.patientId, attachmentId: created!.id });
      return created!.id;
    });
    return { ok: true, attachmentId };
  } catch (error) {
    // O banco não registrou: não deixa o arquivo órfão. Se nem isso der certo, o arquivo fica sem linha
    // (ilegível para todos) e só o caminho (UUID, sem dado pessoal) vai ao log para a limpeza futura.
    const removed = await store.remove(path);
    if (!removed.ok) console.error(`Storage: envio órfão sem registro no banco (caminho ${path}).`);
    return toFailure(error);
  }
}

/**
 * Abrir: lê a linha (a RLS decide: autor e admin; a recepção nem toca o banco), grava o acesso e SÓ
 * DEPOIS busca o arquivo. O autor não abre anexo que removeu; o admin abre, mesmo removido.
 */
export async function openAttachment(
  user: AttachmentReader,
  input: { patientId: string; attachmentId: string },
  store: AttachmentStore,
): Promise<OpenResult> {
  if (user.role === "reception" || !isUuid(input.attachmentId) || !isUuid(input.patientId)) return { ok: false, reason: "not-found" };
  let row: { storagePath: string; contentType: string; originalName: string; sizeBytes: number; sha256: string } | null;
  try {
    row = await withUser(user, async (tx) => {
      const [found] = await tx
        .select({
          id: clinicalAttachments.id,
          patientId: clinicalAttachments.patientId,
          storagePath: clinicalAttachments.storagePath,
          contentType: clinicalAttachments.contentType,
          originalName: clinicalAttachments.originalName,
          sizeBytes: clinicalAttachments.sizeBytes,
          sha256: clinicalAttachments.sha256,
          removedAt: clinicalAttachments.removedAt,
        })
        .from(clinicalAttachments)
        .where(and(eq(clinicalAttachments.id, input.attachmentId), eq(clinicalAttachments.patientId, input.patientId)))
        .limit(1);
      if (!found || (user.role !== "admin" && found.removedAt !== null)) return null;
      await recordAccess(tx, { action: "read_attachment", patientId: found.patientId, attachmentId: found.id });
      return found;
    });
  } catch (error) {
    throw withoutQueryDetails(error);
  }
  if (!row) return { ok: false, reason: "not-found" };

  const got = await store.get(row.storagePath);
  if (!got.ok) return { ok: false, reason: "unavailable" };
  // O que veio do Storage tem de ser exatamente o que foi registrado no envio (tamanho e hash).
  if (got.value.length !== row.sizeBytes || createHash("sha256").update(got.value).digest("hex") !== row.sha256) {
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true, file: { bytes: got.value, contentType: row.contentType as AttachmentType, name: row.originalName } };
}

/** Remover (lógico): só o autor, uma vez; o arquivo e a linha ficam. */
export async function removeAttachment(user: AttachmentWriter, input: { attachmentId: string }): Promise<AttachmentResult> {
  try {
    const attachmentId = await withUser(user, async (tx) => {
      const professionalId = await authorOf(tx, user.userId);
      const [found] = await tx
        .select({ id: clinicalAttachments.id, patientId: clinicalAttachments.patientId, professionalId: clinicalAttachments.professionalId })
        .from(clinicalAttachments)
        .where(eq(clinicalAttachments.id, input.attachmentId))
        .limit(1);
      if (!found || found.professionalId !== professionalId) throw new Abort("not-found");
      const rows = await tx
        .update(clinicalAttachments)
        .set({ removedAt: sql`now()` })
        .where(and(eq(clinicalAttachments.id, found.id), isNull(clinicalAttachments.removedAt)))
        .returning({ id: clinicalAttachments.id });
      if (!rows[0]) throw new Abort("not-found");
      await recordAccess(tx, { action: "remove_attachment", patientId: found.patientId, attachmentId: found.id });
      return found.id;
    });
    return { ok: true, attachmentId };
  } catch (error) {
    return toFailure(error);
  }
}
