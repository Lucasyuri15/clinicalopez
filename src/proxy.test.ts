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

describe("proxy: Content-Security-Policy com nonce", () => {
  const nonceOf = (csp: string | null) => /'nonce-([^']+)'/.exec(csp ?? "")?.[1];

  it("resposta normal: CSP com nonce, e o MESMO nonce vai para a requisição (de onde o Next o lê)", async () => {
    const response = await call("/login");
    const csp = response.headers.get("content-security-policy");
    const nonce = nonceOf(csp);
    expect(nonce).toBeTruthy();
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    // `NextResponse.next({ request })` repassa os cabeçalhos da requisição assim. O Next lê
    // o nonce DESTE cabeçalho; não existe `x-nonce` (nada no app o consumiria).
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(response.headers.get("x-middleware-request-x-nonce")).toBeNull();
  });

  it("redirecionamento também leva a CSP", async () => {
    const response = await call("/dashboard"); // sem sessão → /login
    expect(response.status).toBe(307);
    expect(response.headers.get("content-security-policy")).toContain("'nonce-");
    expect(response.headers.get("x-nonce")).toBeNull();
  });

  it("nonce novo a cada requisição", async () => {
    const nonces = new Set<string | undefined>();
    for (let i = 0; i < 20; i++) {
      nonces.add(nonceOf((await call("/login")).headers.get("content-security-policy")));
    }
    expect(nonces.size).toBe(20);
  });

  it("uma CSP enviada pelo cliente NÃO é aproveitada (o proxy sempre gera a sua)", async () => {
    const request = new NextRequest("http://localhost:3000/login", {
      headers: {
        "content-security-policy": "script-src 'nonce-ZXZpbA==' 'unsafe-inline'",
      },
    });
    const response = await proxy(request);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).not.toContain("ZXZpbA==");
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
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
