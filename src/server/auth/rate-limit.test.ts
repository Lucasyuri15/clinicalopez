// @vitest-environment node
import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AttemptCounts } from "@/lib/auth/rate-limit-policy";

const state = vi.hoisted(() => ({
  headers: {} as Record<string, string>,
  ipHeader: undefined as string | undefined,
  counts: null as unknown,
  beginError: null as Error | null,
  releaseError: null as Error | null,
}));
const attempts = vi.hoisted(() => ({
  beginAttempt: vi.fn(),
  releaseAttempt: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers(state.headers) }));
vi.mock("@/server/env", () => ({ getServerEnv: () => ({ CLIENT_IP_HEADER: state.ipHeader }) }));
vi.mock("@/server/db/attempts", () => attempts);

import { beginRateLimited } from "./rate-limit";

const none: AttemptCounts = {
  ipFailures: 0,
  ipLastAgeS: null,
  pairFailures: 0,
  pairLastAgeS: null,
  subjectFailures: 0,
};
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const EMAIL = "maria.ficticia@teste.invalid";
const IP = "203.0.113.7";

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  state.headers = { "x-real-ip": IP };
  state.ipHeader = undefined;
  state.counts = none;
  state.beginError = null;
  state.releaseError = null;
  attempts.beginAttempt.mockImplementation(async () => {
    if (state.beginError) throw state.beginError;
    return { attemptId: "42", counts: state.counts };
  });
  attempts.releaseAttempt.mockImplementation(async () => {
    if (state.releaseError) throw state.releaseError;
  });
});

describe("beginRateLimited: o que vai para o banco", () => {
  it("manda o tipo, o IP do cabeçalho, o HASH do e-mail (nunca o e-mail) e a janela", async () => {
    await beginRateLimited("login", EMAIL);
    expect(attempts.beginAttempt).toHaveBeenCalledWith({
      kind: "login",
      ip: IP,
      subjectHash: sha(EMAIL),
      windowS: 15 * 60,
    });
    expect(JSON.stringify(attempts.beginAttempt.mock.calls)).not.toContain(EMAIL);
  });

  it("normaliza o e-mail (maiúsculas e espaços não criam outro balde)", async () => {
    await beginRateLimited("login", `  ${EMAIL.toUpperCase()} `);
    expect(attempts.beginAttempt.mock.calls[0]?.[0].subjectHash).toBe(sha(EMAIL));
  });

  it("2FA: a chave é o usuário da sessão (hash do ID)", async () => {
    await beginRateLimited("mfa", "11111111-1111-4111-8111-111111111111");
    expect(attempts.beginAttempt.mock.calls[0]?.[0]).toMatchObject({
      kind: "mfa",
      subjectHash: sha("11111111-1111-4111-8111-111111111111"),
    });
  });

  it("usa o cabeçalho configurado em CLIENT_IP_HEADER, e ignora os outros", async () => {
    state.ipHeader = "cf-connecting-ip";
    state.headers = { "cf-connecting-ip": "198.51.100.9", "x-real-ip": IP };
    await beginRateLimited("login", EMAIL);
    expect(attempts.beginAttempt.mock.calls[0]?.[0].ip).toBe("198.51.100.9");
  });

  it("sem IP confiável usa o balde 'unknown'", async () => {
    state.headers = {};
    await beginRateLimited("login", EMAIL);
    expect(attempts.beginAttempt.mock.calls[0]?.[0].ip).toBe("unknown");
  });
});

describe("beginRateLimited: decisão", () => {
  it("sem falhas libera, e `succeed` apaga a tentativa e as falhas do par (perdão)", async () => {
    const gate = await beginRateLimited("login", EMAIL);
    expect(gate.status).toBe("allowed");
    if (gate.status !== "allowed") return;
    expect(attempts.releaseAttempt).not.toHaveBeenCalled(); // falha deixa a linha; só o sucesso apaga
    await gate.succeed();
    expect(attempts.releaseAttempt).toHaveBeenCalledWith("42", true);
  });

  it("não oferece como apagar uma tentativa sem perdão (429 do Supabase conta como falha: senão o atacante some do contador)", async () => {
    const gate = await beginRateLimited("login", EMAIL);
    expect(Object.keys(gate).sort()).toEqual(["status", "succeed"]);
  });

  it("acima do teto bloqueia, informa a espera e APAGA a própria linha (bloqueio não prolonga o bloqueio)", async () => {
    state.counts = { ...none, pairFailures: 5, pairLastAgeS: 10 };
    const gate = await beginRateLimited("login", EMAIL);
    expect(gate).toEqual({ status: "blocked", retryAfterSeconds: 50 });
    expect(attempts.releaseAttempt).toHaveBeenCalledWith("42", false);
  });

  it("falha ao apagar a linha de uma tentativa bloqueada não vira erro (continua bloqueado)", async () => {
    state.counts = { ...none, pairFailures: 5, pairLastAgeS: 10 };
    state.releaseError = new Error("banco fora");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(beginRateLimited("login", EMAIL)).resolves.toMatchObject({ status: "blocked" });
  });

  it("falha ao perdoar depois de um login certo não derruba o login", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const gate = await beginRateLimited("login", EMAIL);
    if (gate.status !== "allowed") throw new Error("esperava liberado");
    state.releaseError = new Error("banco fora");
    await expect(gate.succeed()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});

describe("beginRateLimited: falha fechada e logs sem dados pessoais", () => {
  it("se o banco falhar NÃO libera: devolve 'unavailable' (sem proteção não há login)", async () => {
    state.beginError = new Error("connection refused");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(beginRateLimited("login", EMAIL)).resolves.toEqual({ status: "unavailable" });
  });

  it("nenhum log contém o e-mail, o IP ou o ID do usuário", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.beginError = new Error(`falha para ${EMAIL} em ${IP}`);
    await beginRateLimited("login", EMAIL);
    state.beginError = null;
    state.counts = { ...none, subjectFailures: 90 }; // múltiplo do limite: dispara o alerta
    await beginRateLimited("login", EMAIL);
    state.releaseError = new Error("x");
    const gate = await beginRateLimited("mfa", "11111111-1111-4111-8111-111111111111");
    if (gate.status === "allowed") await gate.succeed();

    const logged = JSON.stringify([...error.mock.calls, ...warn.mock.calls]);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(IP);
    expect(logged).not.toContain("11111111-1111-4111-8111-111111111111");
    expect(warn).toHaveBeenCalled(); // o alerta de e-mail atacado por vários IPs existe
  });

  it("registra o código SQLSTATE do erro (sem PII), para saber se foi lock_timeout, timeout ou queda", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    state.beginError = Object.assign(new Error(`falha para ${EMAIL} em ${IP}`), { code: "55P03" });
    await beginRateLimited("login", EMAIL);
    // o drizzle embrulha o erro do Postgres em `cause`
    state.beginError = new Error(`falha para ${EMAIL}`, {
      cause: Object.assign(new Error(IP), { code: "57014" }),
    });
    await beginRateLimited("login", EMAIL);
    state.beginError = new Error("sem código (ex.: resposta inesperada do banco)");
    await beginRateLimited("login", EMAIL);

    const lines = error.mock.calls.map((call) => String(call[0]));
    expect(lines[0]).toContain("55P03");
    expect(lines[1]).toContain("57014");
    expect(lines[2]).toContain("n/d");
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(EMAIL);
    expect(logged).not.toContain(IP);
  });

  it("em produção, IP desconhecido gera UM aviso (sem PII): o cabeçalho do proxy pode estar errado", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.headers = {};
    await beginRateLimited("login", EMAIL);
    await beginRateLimited("login", EMAIL);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("CLIENT_IP_HEADER");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(EMAIL);
  });

  it("fora de produção (dev local não tem x-real-ip), IP desconhecido não gera aviso", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.headers = {};
    await beginRateLimited("login", EMAIL);
    expect(warn).not.toHaveBeenCalled();
  });

  it("muitas falhas do mesmo e-mail em IPs diferentes: libera, mas registra alerta", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    state.counts = { ...none, subjectFailures: 30 };
    const gate = await beginRateLimited("login", EMAIL);
    expect(gate.status).toBe("allowed");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
