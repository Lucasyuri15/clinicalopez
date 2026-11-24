import "server-only";

import { and, eq } from "drizzle-orm";

import { pgErrorCode, withoutQueryDetails } from "@/server/db/pg-error";
import { appointments, clinicalNoteAddenda, clinicalNotes } from "@/server/db/schema";
import { withUser, type Tx } from "@/server/db/with-user";

import { recordAccess } from "./access-log";
import { Abort, authorOf } from "./author";

/**
 * Gravações do prontuário (Fase 4A), sempre por `withUser` (a RLS e os gatilhos decidem; a camada de
 * ações ainda exige o papel profissional). O resultado é um VALOR, não uma exceção: o erro do banco
 * nunca sobe para a tela (nem o texto dele, que poderia trazer dado clínico). Cada pedido é uma
 * transação e grava o log de acesso junto.
 *
 *  - `not-found`: o atendimento ou a evolução não existe ou a RLS o esconde (inclusive o de outro
 *    profissional: quem não enxerga, "não existe");
 *  - `not-realized`: o atendimento não está Realizado;
 *  - `locked`: a evolução já foi finalizada (salvar ou finalizar de novo);
 *  - `not-finalized`: o adendo só vale para evolução finalizada;
 *  - `denied`: o banco recusou (sem permissão, texto inválido...) ou o login não é de um profissional;
 *  - `busy`: deadlock, serialização ou o primeiro salvamento disputado; é só tentar de novo.
 */
export type ClinicalFailure = "not-found" | "not-realized" | "locked" | "not-finalized" | "denied" | "busy";

export type ClinicalResult = { ok: true; noteId: string } | { ok: false; reason: ClinicalFailure };

export type ClinicalWriter = { userId: string };

function toFailure(error: unknown): Extract<ClinicalResult, { ok: false }> {
  if (error instanceof Abort) return { ok: false, reason: error.reason as ClinicalFailure };
  switch (pgErrorCode(error)) {
    case "23505": // o índice único: outro primeiro salvamento do mesmo atendimento ganhou a corrida
    case "40P01": // deadlock
    case "40001": // falha de serialização
    case "55P03": // lock_timeout
      return { ok: false, reason: "busy" };
    case "42501": // RLS ou gatilho
    case "23503": // chave estrangeira
    case "23514": // CHECK do texto
    case "22021": // byte inválido no texto
    case "22P02": // texto inválido para o tipo
      return { ok: false, reason: "denied" };
    default:
      // Erro inesperado (conexão...): não engolir, mas SEM a consulta e os parâmetros no log.
      throw withoutQueryDetails(error);
  }
}

async function run(user: ClinicalWriter, body: (tx: Tx, professionalId: string) => Promise<string>): Promise<ClinicalResult> {
  try {
    return {
      ok: true,
      noteId: await withUser(user, async (tx) => body(tx, await authorOf(tx, user.userId))),
    };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Salvar a evolução de um atendimento: o 1º salvamento COM TEXTO cria o rascunho (nunca há rascunho
 * vazio); os seguintes atualizam o rascunho; uma evolução finalizada devolve `locked`.
 */
export function saveNote(user: ClinicalWriter, input: { appointmentId: string; body: string }): Promise<ClinicalResult> {
  return run(user, async (tx, professionalId) => {
    const [existing] = await tx
      .select({ id: clinicalNotes.id, status: clinicalNotes.status, patientId: clinicalNotes.patientId, professionalId: clinicalNotes.professionalId })
      .from(clinicalNotes)
      .where(eq(clinicalNotes.appointmentId, input.appointmentId))
      .limit(1);
    if (existing) {
      if (existing.professionalId !== professionalId) throw new Abort("not-found");
      if (existing.status !== "draft") throw new Abort("locked");
      const rows = await tx
        .update(clinicalNotes)
        .set({ body: input.body })
        .where(and(eq(clinicalNotes.id, existing.id), eq(clinicalNotes.status, "draft")))
        .returning({ id: clinicalNotes.id });
      // Finalizada entre a leitura e a gravação (a RLS só deixa mudar linha `draft`).
      if (!rows[0]) throw new Abort("locked");
      await recordAccess(tx, { action: "update_draft", patientId: existing.patientId, noteId: existing.id });
      return existing.id;
    }

    const [appointment] = await tx
      .select({ id: appointments.id, patientId: appointments.patientId, professionalId: appointments.professionalId, status: appointments.status })
      .from(appointments)
      .where(eq(appointments.id, input.appointmentId))
      .limit(1);
    if (!appointment || appointment.professionalId !== professionalId) throw new Abort("not-found");
    if (appointment.status !== "done") throw new Abort("not-realized");
    const [created] = await tx
      .insert(clinicalNotes)
      .values({ appointmentId: appointment.id, patientId: appointment.patientId, professionalId, body: input.body })
      .returning({ id: clinicalNotes.id });
    await recordAccess(tx, { action: "create_note", patientId: appointment.patientId, noteId: created!.id });
    return created!.id;
  });
}

/** Carrega a evolução do próprio autor (a RLS esconde as dos outros); senão `not-found`. */
async function ownNote(tx: Tx, professionalId: string, noteId: string) {
  const [note] = await tx
    .select({ id: clinicalNotes.id, status: clinicalNotes.status, patientId: clinicalNotes.patientId, professionalId: clinicalNotes.professionalId })
    .from(clinicalNotes)
    .where(eq(clinicalNotes.id, noteId))
    .limit(1);
  if (!note || note.professionalId !== professionalId) throw new Abort("not-found");
  return note;
}

/** Finalizar: o texto fica trancado pelo banco; o carimbo de quem e quando é dele. */
export function finalizeNote(user: ClinicalWriter, input: { noteId: string }): Promise<ClinicalResult> {
  return run(user, async (tx, professionalId) => {
    const note = await ownNote(tx, professionalId, input.noteId);
    if (note.status !== "draft") throw new Abort("locked");
    const rows = await tx
      .update(clinicalNotes)
      .set({ status: "finalized" })
      .where(and(eq(clinicalNotes.id, note.id), eq(clinicalNotes.status, "draft")))
      .returning({ id: clinicalNotes.id });
    if (!rows[0]) throw new Abort("locked");
    await recordAccess(tx, { action: "finalize", patientId: note.patientId, noteId: note.id });
    return note.id;
  });
}

/** Adendo: correção ou complemento de uma evolução JÁ finalizada (o original fica intacto). */
export function addAddendum(user: ClinicalWriter, input: { noteId: string; body: string }): Promise<ClinicalResult> {
  return run(user, async (tx, professionalId) => {
    const note = await ownNote(tx, professionalId, input.noteId);
    if (note.status !== "finalized") throw new Abort("not-finalized");
    await tx.insert(clinicalNoteAddenda).values({ noteId: note.id, body: input.body });
    await recordAccess(tx, { action: "add_addendum", patientId: note.patientId, noteId: note.id });
    return note.id;
  });
}
