import type { AttachmentStore, StoreFailure, StoreResult } from "./types";

type Operation = "put" | "get" | "remove";

/**
 * Armazenamento em memória, só para testes da camada de dados (nada de rede). Guarda uma CÓPIA dos
 * bytes, nunca sobrescreve e permite injetar uma falha na próxima operação.
 */
export function createMemoryStore() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const failures: Partial<Record<Operation, StoreFailure>> = {};

  const takeFailure = (operation: Operation): StoreFailure | undefined => {
    const reason = failures[operation];
    delete failures[operation];
    return reason;
  };

  const store: AttachmentStore = {
    async put(path, bytes, contentType): Promise<StoreResult> {
      const reason = takeFailure("put");
      if (reason) return { ok: false, reason };
      if (objects.has(path)) return { ok: false, reason: "exists" };
      objects.set(path, { bytes: new Uint8Array(bytes), contentType });
      return { ok: true };
    },
    async get(path): Promise<StoreResult<Uint8Array>> {
      const reason = takeFailure("get");
      if (reason) return { ok: false, reason };
      const object = objects.get(path);
      return object ? { ok: true, value: new Uint8Array(object.bytes) } : { ok: false, reason: "not-found" };
    },
    async remove(path): Promise<StoreResult> {
      const reason = takeFailure("remove");
      if (reason) return { ok: false, reason };
      return objects.delete(path) ? { ok: true } : { ok: false, reason: "not-found" };
    },
  };

  return Object.assign(store, {
    objects,
    /** A PRÓXIMA chamada de `operation` falha com `reason` (e depois tudo volta ao normal). */
    failNext(operation: Operation, reason: StoreFailure) {
      failures[operation] = reason;
    },
  });
}
