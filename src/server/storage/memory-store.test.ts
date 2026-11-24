import { describe, expect, it } from "vitest";

import { createMemoryStore } from "./memory-store";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("createMemoryStore (o falso usado nos testes da camada de dados)", () => {
  it("guarda e devolve o mesmo conteúdo", async () => {
    const store = createMemoryStore();
    expect(await store.put("a", bytes(1, 2, 3), "application/pdf")).toEqual({ ok: true });
    expect(await store.get("a")).toEqual({ ok: true, value: bytes(1, 2, 3) });
    expect(store.objects.get("a")?.contentType).toBe("application/pdf");
  });

  it("não sobrescreve: gravar o mesmo caminho de novo é `exists` e o original fica", async () => {
    const store = createMemoryStore();
    await store.put("a", bytes(1), "application/pdf");
    expect(await store.put("a", bytes(9), "application/pdf")).toEqual({ ok: false, reason: "exists" });
    expect(await store.get("a")).toEqual({ ok: true, value: bytes(1) });
  });

  it("ler ou apagar o que não existe é `not-found`", async () => {
    const store = createMemoryStore();
    expect(await store.get("x")).toEqual({ ok: false, reason: "not-found" });
    expect(await store.remove("x")).toEqual({ ok: false, reason: "not-found" });
  });

  it("apaga o que existe", async () => {
    const store = createMemoryStore();
    await store.put("a", bytes(1), "image/png");
    expect(await store.remove("a")).toEqual({ ok: true });
    expect(store.objects.has("a")).toBe(false);
  });

  it("guarda uma CÓPIA: mudar o buffer de quem enviou não muda o armazenado", async () => {
    const store = createMemoryStore();
    const original = bytes(1, 2);
    await store.put("a", original, "image/png");
    original[0] = 99;
    expect(await store.get("a")).toEqual({ ok: true, value: bytes(1, 2) });
  });

  it("injeta falhas para os testes: a próxima operação falha e depois volta ao normal", async () => {
    const store = createMemoryStore();
    store.failNext("put", "unavailable");
    expect(await store.put("a", bytes(1), "image/png")).toEqual({ ok: false, reason: "unavailable" });
    expect(store.objects.size).toBe(0);
    expect(await store.put("a", bytes(1), "image/png")).toEqual({ ok: true });
    store.failNext("get", "unavailable");
    expect(await store.get("a")).toEqual({ ok: false, reason: "unavailable" });
    expect(await store.get("a")).toMatchObject({ ok: true });
  });
});
