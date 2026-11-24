import "server-only";

import { getAttachmentStore } from "@/server/storage";

import { type AttachmentReader, type OpenResult, openAttachment } from "./attachments";

/**
 * Abrir um anexo para uma requisição web (o Route Handler): junta o armazenamento da requisição (JWT do
 * usuário) à regra `openAttachment`. Existe para que SÓ `src/server/clinical/` importe o Storage
 * (`storage-guard.test.ts`): a rota não toca o armazenamento diretamente.
 */
export async function openAttachmentForRequest(
  user: AttachmentReader,
  input: { patientId: string; attachmentId: string },
): Promise<OpenResult> {
  return openAttachment(user, input, await getAttachmentStore());
}
