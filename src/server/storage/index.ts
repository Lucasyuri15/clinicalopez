import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { createSupabaseStore } from "./supabase-store";
import type { AttachmentStore } from "./types";

export type { AttachmentStore, StoreFailure, StoreResult } from "./types";

/** Bucket privado dos anexos clínicos (criado na migração 0042). */
export const CLINICAL_ATTACHMENTS_BUCKET = "clinical-attachments";

/**
 * Armazenamento dos anexos clínicos para ESTA requisição, com o JWT do usuário logado (a RLS de
 * `storage.objects` decide). Só `src/server/clinical/` o usa.
 */
export async function getAttachmentStore(): Promise<AttachmentStore> {
  const client = await createSupabaseServerClient();
  return createSupabaseStore(client as unknown as Parameters<typeof createSupabaseStore>[0], CLINICAL_ATTACHMENTS_BUCKET);
}
