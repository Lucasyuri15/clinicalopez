import { describe, expect, it, vi } from "vitest";

import { createSupabaseStore, type StorageClientLike } from "./supabase-store";

const bytes = (...values: number[]) => new Uint8Array(values);
const apiError = (status: number) => ({ message: "mensagem interna do Storage com detalhes", status });

function client(bucket: Record<string, unknown>) {
  const from = vi.fn(() => bucket);
  return { client: { storage: { from } } as unknown as StorageClientLike, from };
}

describe("createSupabaseStore", () => {
  it("put: envia ao bucket certo, com o tipo, SEM upsert", async () => {
    const upload = vi.fn(async () => ({ data: { path: "p" }, error: null }));
    const { client: c, from } = client({ upload });
    const store = createSupabaseStore(c, "meu-bucket");
    expect(await store.put("p", bytes(1, 2), "application/pdf")).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("meu-bucket");
    expect(upload).toHaveBeenCalledWith("p", bytes(1, 2), { contentType: "application/pdf", upsert: false });
  });

  it.each([
    [409, "exists"],
    [400, "rejected"],
    [401, "rejected"],
    [403, "rejected"],
    [413, "rejected"],
    [415, "rejected"],
    [404, "not-found"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const)("put: status %s vira `%s`, sem repassar a mensagem do Storage", async (status, reason) => {
    const upload = vi.fn(async () => ({ data: null, error: apiError(status) }));
    const store = createSupabaseStore(client({ upload }).client, "b");
    const result = await store.put("p", bytes(1), "application/pdf");
    expect(result).toEqual({ ok: false, reason });
    expect(JSON.stringify(result)).not.toContain("mensagem interna");
  });

  it("put: exceção de rede vira `unavailable`", async () => {
    const upload = vi.fn(async () => {
      throw new Error("ECONNRESET com detalhes");
    });
    const store = createSupabaseStore(client({ upload }).client, "b");
    expect(await store.put("p", bytes(1), "application/pdf")).toEqual({ ok: false, reason: "unavailable" });
  });

  it("get: devolve os bytes do Blob", async () => {
    const download = vi.fn(async () => ({ data: new Blob([bytes(7, 8, 9)]), error: null }));
    const store = createSupabaseStore(client({ download }).client, "b");
    expect(await store.get("p")).toEqual({ ok: true, value: bytes(7, 8, 9) });
    expect(download).toHaveBeenCalledWith("p");
  });

  it("get: objeto que o usuário não enxerga (a RLS esconde) é `not-found`, igual ao que não existe", async () => {
    const download = vi.fn(async () => ({ data: null, error: apiError(404) }));
    const store = createSupabaseStore(client({ download }).client, "b");
    expect(await store.get("p")).toEqual({ ok: false, reason: "not-found" });
  });

  it("remove: nenhum objeto removido (a RLS não deixou) é `not-found`; removido é ok", async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const store = createSupabaseStore(client({ remove }).client, "b");
    expect(await store.remove("p")).toEqual({ ok: false, reason: "not-found" });
    expect(remove).toHaveBeenCalledWith(["p"]);
    const removeOk = vi.fn(async () => ({ data: [{ name: "p" }], error: null }));
    expect(await createSupabaseStore(client({ remove: removeOk }).client, "b").remove("p")).toEqual({ ok: true });
  });

  it("remove: erro do Storage é mapeado, nunca repassado", async () => {
    const remove = vi.fn(async () => ({ data: null, error: apiError(500) }));
    const result = await createSupabaseStore(client({ remove }).client, "b").remove("p");
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });
});
