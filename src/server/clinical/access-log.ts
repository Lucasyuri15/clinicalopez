import "server-only";

import { type ClinicalAccessAction, clinicalAccessLog } from "@/server/db/schema";
import type { Tx } from "@/server/db/with-user";

/**
 * Registro de acesso ao prontuário (Fase 4A). SEMPRE na MESMA transação da leitura ou da gravação que
 * ele registra: se o log não puder ser escrito, a transação inteira desfaz e nada é devolvido (falha
 * fechada). Guarda só QUEM, QUANDO (banco), AÇÃO, paciente e evolução ou anexo; NUNCA o texto clínico nem o nome do arquivo. `user_id`,
 * `role` e `at` vêm do banco (a política confere); o código nem os informa.
 */
export type AccessEntry = { action: ClinicalAccessAction; patientId: string; noteId?: string; attachmentId?: string };

export async function recordAccess(tx: Tx, entries: AccessEntry | AccessEntry[]): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  await tx
    .insert(clinicalAccessLog)
    .values(
      list.map((entry) => ({
        action: entry.action,
        patientId: entry.patientId,
        noteId: entry.noteId ?? null,
        attachmentId: entry.attachmentId ?? null,
      })),
    );
}
