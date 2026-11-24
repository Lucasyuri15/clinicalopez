import type { AttachmentStore, StoreFailure, StoreResult } from "./types";

type StorageErrorLike = { status?: number } | null;

/** O pedaço do cliente do Supabase que o driver usa (facilita testar sem rede). */
type BucketLike = {
  upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): Promise<{ error: StorageErrorLike }>;
  download(path: string): Promise<{ data: Blob | null; error: StorageErrorLike }>;
  remove(paths: string[]): Promise<{ data: unknown[] | null; error: StorageErrorLike }>;
};
export type StorageClientLike = { storage: { from(bucket: string): BucketLike } };

/** Status HTTP do Storage -> motivo. A mensagem do provedor NUNCA é repassada. */
function reasonOf(error: NonNullable<StorageErrorLike>): StoreFailure {
  switch (error.status) {
    case 404:
      return "not-found";
    case 409:
      return "exists";
    case 400:
    case 401:
    case 403:
    case 413:
    case 415:
    case 422:
      return "rejected";
    default:
      return "unavailable";
  }
}

/**
 * Driver do Supabase Storage. Recebe o cliente da REQUISIÇÃO (o JWT do usuário: quem decide é a RLS
 * de `storage.objects`; nenhuma chave secret no app). Nunca usa `upsert`.
 */
export function createSupabaseStore(client: StorageClientLike, bucket: string): AttachmentStore {
  const files = () => client.storage.from(bucket);
  return {
    async put(path, bytes, contentType): Promise<StoreResult> {
      try {
        const { error } = await files().upload(path, bytes, { contentType, upsert: false });
        return error ? { ok: false, reason: reasonOf(error) } : { ok: true };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
    async get(path): Promise<StoreResult<Uint8Array>> {
      try {
        const { data, error } = await files().download(path);
        if (error) return { ok: false, reason: reasonOf(error) };
        if (!data) return { ok: false, reason: "not-found" };
        return { ok: true, value: new Uint8Array(await data.arrayBuffer()) };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
    async remove(path): Promise<StoreResult> {
      try {
        const { data, error } = await files().remove([path]);
        if (error) return { ok: false, reason: reasonOf(error) };
        return data && data.length > 0 ? { ok: true } : { ok: false, reason: "not-found" };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
  };
}
