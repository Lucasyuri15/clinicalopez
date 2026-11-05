// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SetAll = (
  cookies: { name: string; value: string; options: Record<string, unknown> }[],
  headers: Record<string, string>,
) => void;

const state = vi.hoisted(() => ({
  claimsResult: { data: null, error: null } as {
    data: { claims: { aal?: string } } | null;
    error: unknown;
  },
  refreshCookies: false,
  lastOptions: undefined as { cookieOptions?: Record<string, unknown> } | undefined,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: { setAll: SetAll }; cookieOptions?: Record<string, unknown> },
  ) => {
    state.lastOptions = options;
    return {
    auth: {
      getClaims: async () => {
        if (state.refreshCookies) {
          options.cookies.setAll(
            [{ name: "sb-teste-auth-token", value: "novo", options: { path: "/", httpOnly: false, maxAge: 400 * 24 * 60 * 60 } }],
            { "cache-control": "private, no-cache, no-store, must-revalidate, max-age=0" },
          );
        }
        return state.claimsResult;
      },
    },
    };
  },
}));

import { config, proxy } from "./proxy";

const call = (path: string) =>
  proxy(new NextRequest(`http://localhost:3000${path}`));
const withAal = (aal: string) => {
  state.claimsResult = { data: { claims: { aal } }, error: null };
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghij.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_chave-fake-123");
  state.claimsResult = { data: null, error: null };
  state.refreshCookies = false;
});

describe("proxy", () => {
  it("sem sessão: redireciona telas do app para /login", async () => {
    const response = await call("/dashboard");
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("sem sessão: deixa passar /login", async () => {
    const response = await call("/login");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("aal1: manda o app para /mfa e deixa passar /mfa/enroll", async () => {
    withAal("aal1");
    const redirected = await call("/financeiro");
    expect(new URL(redirected.headers.get("location") ?? "").pathname).toBe("/mfa");
    const allowed = await call("/mfa/enroll");
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
  });

  it("aal2: deixa passar o app e tira de /login", async () => {
    withAal("aal2");
    expect((await call("/agenda")).headers.get("x-middleware-next")).toBe("1");
    const response = await call("/login");
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/dashboard");
  });

  it("falha ao verificar o token (erro) conta como sem sessão", async () => {
    state.claimsResult = { data: null, error: new Error("jwks indisponível") };
    const response = await call("/dashboard");
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("redirecionamento descarta query e não aceita destino externo", async () => {
    const response = await call("/dashboard?next=https://evil.example");
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.origin).toBe("http://localhost:3000");
    expect(location.search).toBe("");
  });

  it("preserva cookies renovados e cabeçalhos anti-cache no redirecionamento", async () => {
    state.refreshCookies = true;
    withAal("aal1");
    const response = await call("/dashboard");
    expect(response.status).toBe(307);
    expect(response.cookies.get("sb-teste-auth-token")?.value).toBe("novo");
    // a biblioteca manda 400 dias e HttpOnly=false: o proxy impõe as opções seguras
    expect(response.cookies.get("sb-teste-auth-token")).toMatchObject({ httpOnly: true, maxAge: 8 * 60 * 60 });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("usa cookies de sessão HttpOnly, SameSite=Lax e de curta duração", async () => {
    await call("/login");
    expect(state.lastOptions?.cookieOptions).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      maxAge: 8 * 60 * 60,
    });
  });

  it("sem as variáveis do Supabase falha em vez de liberar (falha fechada)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    await expect(call("/dashboard")).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

describe("config.matcher (avaliado como regex de verdade)", () => {
  const [pattern = ""] = config.matcher;
  // O corpo do matcher é uma regex comum; o Next a ancora no caminho inteiro.
  const proxied = (path: string) => new RegExp(`^${pattern}$`).test(path);

  it("passa pelo proxy tudo que não é um asset público conhecido", () => {
    for (const path of ["/", "/dashboard", "/mfa/enroll", "/qualquer-coisa", "//dashboard", "/%2e/dashboard"]) {
      expect(proxied(path), path).toBe(true);
    }
  });

  it("NÃO deixa o proxy de fora por prefixo parecido (bypass por nome de rota)", () => {
    for (const path of ["/robots.txtX", "/robots-txt", "/icon.pngfoo", "/favicon.icoX", "/_next/staticX", "/_next/image/x", "/brandX/a"]) {
      expect(proxied(path), path).toBe(true);
    }
  });

  it("exclui só os assets públicos exatos", () => {
    for (const path of ["/robots.txt", "/icon.png", "/favicon.ico", "/_next/static/chunks/a.js", "/_next/image", "/brand/logo.png"]) {
      expect(proxied(path), path).toBe(false);
    }
  });
});
