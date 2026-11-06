// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  signOutCalls: [] as unknown[],
  claimsCalls: 0,
  // true = o signOut do Supabase nunca responde (Auth pendurado).
  signOutHangs: false,
  // false = o signOut do Supabase falha (rede) e NÃO limpa nada: o proxy tem de limpar sozinho.
  signOutClears: true,
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
        state.claimsCalls++;
        if (state.refreshCookies) {
          options.cookies.setAll(
            [{ name: "sb-teste-auth-token", value: "novo", options: { path: "/", httpOnly: false, maxAge: 400 * 24 * 60 * 60 } }],
            { "cache-control": "private, no-cache, no-store, must-revalidate, max-age=0" },
          );
        }
        return state.claimsResult;
      },
      signOut: async (args: unknown) => {
        state.signOutCalls.push(args);
        if (state.signOutHangs) return new Promise(() => {});
        if (!state.signOutClears) return { error: new Error("rede indisponível") };
        options.cookies.setAll(
          [{ name: "sb-abcdefghij-auth-token", value: "", options: { path: "/", maxAge: 0 } }],
          { "cache-control": "private, no-cache, no-store, must-revalidate, max-age=0" },
        );
        return { error: null };
      },
    },
    };
  },
}));

import { config, proxy } from "./proxy";

const call = (
  path: string,
  init?: { cookie?: string; headers?: Record<string, string>; method?: string },
) =>
  proxy(
    new NextRequest(`http://localhost:3000${path}`, {
      method: init?.method,
      headers: { ...(init?.cookie ? { cookie: init.cookie } : {}), ...init?.headers },
    }),
  );
const withAal = (aal: string) => {
  state.claimsResult = { data: { claims: { aal } }, error: null };
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefghij.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_chave-fake-123");
  state.claimsResult = { data: null, error: null };
  state.refreshCookies = false;
  state.signOutCalls = [];
  state.signOutClears = true;
  state.claimsCalls = 0;
  state.signOutHangs = false;
});

afterEach(() => {
  vi.useRealTimers();
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

describe("proxy: timeout de inatividade (30 min)", () => {
  const NOW = 1_800_000_000_000;
  const MIN = 60 * 1000;
  const at = (minutesAgo: number) => `ls_activity=${NOW - minutesAgo * MIN}`;
  const session = "sb-abcdefghij-auth-token=jwt; sb-abcdefghij-auth-token.0=a; sb-abcdefghij-auth-token.1=b; sb-abcdefghij-auth-token-code-verifier=v; outro=x; sb-outro-auth-token=alheio";
  const loginPath = (response: Response) => new URL(response.headers.get("location") ?? "").pathname;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  it("sessão sem registro de atividade: começa a contar agora (HttpOnly, SameSite=Lax, 8 h)", async () => {
    withAal("aal2");
    const response = await call("/agenda", { cookie: session });
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get("ls_activity")).toMatchObject({
      value: String(NOW),
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    expect(state.signOutCalls).toHaveLength(0);
  });

  it("navegação dentro do prazo renova a hora da atividade", async () => {
    withAal("aal2");
    const response = await call("/agenda", { cookie: `${session}; ${at(10)}` });
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get("ls_activity")?.value).toBe(String(NOW));
    expect(state.signOutCalls).toHaveLength(0);
  });

  it("exatamente 30 min ainda vale", async () => {
    withAal("aal2");
    const response = await call("/agenda", { cookie: `${session}; ${at(30)}` });
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(state.signOutCalls).toHaveLength(0);
  });

  it("passou de 30 min: encerra só esta sessão, volta ao /login e apaga os cookies", async () => {
    withAal("aal2");
    const response = await call("/agenda", { cookie: `${session}; ${at(31)}` });
    expect(response.status).toBe(307);
    expect(loginPath(response)).toBe("/login");
    expect(state.signOutCalls).toEqual([{ scope: "local" }]);
    for (const name of [
      "ls_activity",
      "sb-abcdefghij-auth-token",
      "sb-abcdefghij-auth-token.0",
      "sb-abcdefghij-auth-token.1",
      "sb-abcdefghij-auth-token-code-verifier",
    ]) {
      // `Expires` na data zero além de `Max-Age=0`: o Next, ao mesclar os cookies do proxy na
      // resposta de uma Server Action, reparseia o Set-Cookie e descarta o `Max-Age=0`.
      expect(response.cookies.get(name), name).toMatchObject({
        value: "",
        maxAge: 0,
        expires: new Date(0),
      });
    }
    expect(response.cookies.get("outro")).toBeUndefined();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("falha fechada: se o signOut do Supabase falhar, o proxy apaga os cookies mesmo assim", async () => {
    withAal("aal2");
    state.signOutClears = false;
    const response = await call("/agenda", { cookie: `${session}; ${at(45)}` });
    expect(loginPath(response)).toBe("/login");
    expect(response.cookies.get("sb-abcdefghij-auth-token")).toMatchObject({ value: "", maxAge: 0 });
    expect(response.cookies.get("sb-abcdefghij-auth-token.0")).toMatchObject({ value: "", maxAge: 0 });
  });

  it("vale também no meio do 2FA (aal1)", async () => {
    withAal("aal1");
    const response = await call("/mfa", { cookie: `${session}; ${at(31)}` });
    // /mfa é público para aal1; expirado vira sem sessão (aal nulo): só /login é liberada
    expect(loginPath(response)).toBe("/login");
    expect(state.signOutCalls).toHaveLength(1);
  });

  it("Server Action após expirar NÃO leva 307 (o cliente do Next não segue): passa, com os cookies já limpos, e a própria ação manda ao /login", async () => {
    withAal("aal2");
    const response = await call("/dashboard", {
      method: "POST",
      cookie: `${session}; ${at(31)}`,
      headers: { "next-action": "abc123" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(state.signOutCalls).toHaveLength(1);
    expect(response.cookies.get("sb-abcdefghij-auth-token")).toMatchObject({ value: "", maxAge: 0 });
    expect(response.cookies.get("ls_activity")).toMatchObject({ value: "", maxAge: 0 });
    expect(response.headers.get("x-middleware-request-cookie") ?? "").not.toContain("sb-abcdefghij");
    expect(response.headers.get("content-security-policy")).toContain("'nonce-");
  });

  it("Server Action sem sessão também passa (quem protege é cada ação, não o proxy); GET continua redirecionando", async () => {
    const action = await call("/dashboard", {
      method: "POST",
      headers: { "next-action": "abc123" },
    });
    expect(action.headers.get("location")).toBeNull();
    expect(action.headers.get("x-middleware-next")).toBe("1");
    const page = await call("/dashboard");
    expect(loginPath(page)).toBe("/login");
  });

  it("POST sem o cabeçalho de Server Action continua sendo redirecionado", async () => {
    const response = await call("/dashboard", { method: "POST" });
    expect(loginPath(response)).toBe("/login");
  });

  it("expirado, quem abre /login vê a tela (sem redirecionar em laço) e sai com os cookies limpos", async () => {
    withAal("aal2");
    const response = await call("/login", { cookie: `${session}; ${at(31)}` });
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get("ls_activity")).toMatchObject({ value: "", maxAge: 0 });
    expect(response.cookies.get("sb-abcdefghij-auth-token")).toMatchObject({ value: "", maxAge: 0 });
  });

  it("expira ANTES de consultar o token (sem refresh à toa) e mesmo que o Auth esteja fora do ar", async () => {
    state.claimsResult = { data: null, error: new Error("auth indisponível") };
    const response = await call("/agenda", { cookie: `${session}; ${at(40)}` });
    expect(loginPath(response)).toBe("/login");
    expect(state.claimsCalls).toBe(0);
    expect(state.signOutCalls).toHaveLength(1);
    expect(response.cookies.get("sb-abcdefghij-auth-token")).toMatchObject({ value: "", maxAge: 0 });
  });

  it("falha do Auth com sessão ainda dentro do prazo: NÃO apaga o contador (a sessão não ressuscita depois)", async () => {
    state.claimsResult = { data: null, error: new Error("auth indisponível") };
    const response = await call("/agenda", { cookie: `${session}; ${at(10)}` });
    expect(loginPath(response)).toBe("/login");
    expect(response.cookies.get("ls_activity")).toBeUndefined(); // nem apagado, nem renovado
    expect(response.cookies.get("sb-abcdefghij-auth-token")).toBeUndefined();
  });

  it("signOut pendurado não trava a requisição: após 3 s segue e apaga os cookies", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(NOW);
    withAal("aal2");
    state.signOutHangs = true;
    const pending = call("/agenda", { cookie: `${session}; ${at(31)}` });
    await vi.advanceTimersByTimeAsync(3000);
    const response = await pending;
    expect(loginPath(response)).toBe("/login");
    expect(response.cookies.get("sb-abcdefghij-auth-token")).toMatchObject({ value: "", maxAge: 0 });
  });

  it("cookies de OUTRO projeto Supabase e outros cookies não são apagados", async () => {
    withAal("aal2");
    const response = await call("/agenda", { cookie: `${session}; ${at(31)}` });
    expect(response.cookies.get("outro")).toBeUndefined();
    expect(response.cookies.get("sb-outro-auth-token")).toBeUndefined();
  });

  it("os Server Components NÃO enxergam mais a sessão na mesma requisição (cookies saem da requisição)", async () => {
    withAal("aal2");
    const response = await call("/login", { cookie: `${session}; ${at(31)}` });
    const seen = response.headers.get("x-middleware-request-cookie") ?? "";
    expect(seen).not.toContain("sb-abcdefghij");
    expect(seen).not.toContain("ls_activity");
    expect(seen).toContain("outro=x");
    expect(seen).toContain("sb-outro-auth-token=alheio");
  });

  it("renovação do token e do prazo na MESMA resposta", async () => {
    withAal("aal2");
    state.refreshCookies = true;
    const response = await call("/agenda", { cookie: `${session}; ${at(5)}` });
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.cookies.get("sb-teste-auth-token")?.value).toBe("novo");
    expect(response.cookies.get("ls_activity")?.value).toBe(String(NOW));
  });

  it("cookie de atividade adulterado (lixo/futuro) é tratado como ausente, não como 'eterno'", async () => {
    withAal("aal2");
    for (const bad of ["ls_activity=abc", `ls_activity=${NOW + 24 * 60 * MIN}`]) {
      const response = await call("/agenda", { cookie: `${session}; ${bad}` });
      expect(response.cookies.get("ls_activity")?.value).toBe(String(NOW));
      expect(state.signOutCalls).toHaveLength(0);
    }
  });

  it("sem sessão: apaga um cookie de atividade que sobrou (não expira o próximo login)", async () => {
    const response = await call("/login", { cookie: at(120) });
    expect(response.cookies.get("ls_activity")).toMatchObject({ value: "", maxAge: 0 });
    expect(state.signOutCalls).toHaveLength(0);
  });

  it("sem sessão e sem cookie de atividade: não grava nada", async () => {
    const response = await call("/login");
    expect(response.cookies.get("ls_activity")).toBeUndefined();
  });

  it("o redirecionamento comum (aal1 → /mfa) leva o cookie de atividade renovado", async () => {
    withAal("aal1");
    const response = await call("/dashboard", { cookie: `${session}; ${at(5)}` });
    expect(loginPath(response)).toBe("/mfa");
    expect(response.cookies.get("ls_activity")?.value).toBe(String(NOW));
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
