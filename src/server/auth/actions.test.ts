import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  getClaims: vi.fn(),
  mfa: {
    getAuthenticatorAssuranceLevel: vi.fn(),
    listFactors: vi.fn(),
    unenroll: vi.fn(),
    enroll: vi.fn(),
    challengeAndVerify: vi.fn(),
  },
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth }),
}));

import {
  login,
  logout,
  startMfaEnroll,
  verifyMfaEnroll,
  verifyMfaLogin,
} from "./actions";

const FACTOR_ID = "22222222-2222-4222-8222-222222222222";
const SECRET_PASSWORD = "senha-super-secreta-fake";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const redirectedTo = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RedirectSignal) return error.to;
    throw error;
  }
  return null;
};
const withSession = (aal: string | null) =>
  auth.getClaims.mockResolvedValue(
    aal ? { data: { claims: { sub: "u1", aal } }, error: null } : { data: null, error: null },
  );
const withLevels = (currentLevel: string, nextLevel: string) =>
  auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel, nextLevel },
    error: null,
  });

beforeEach(() => {
  vi.clearAllMocks();
  auth.signOut.mockResolvedValue({ error: null });
  auth.mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [] }, error: null });
  auth.mfa.unenroll.mockResolvedValue({ data: {}, error: null });
});

describe("login", () => {
  it("rejeita e-mail inválido sem chamar o Supabase", async () => {
    const state = await login(undefined, form({ email: "x", password: "y" }));
    expect(state).toEqual({ error: "Informe um e-mail válido." });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejeita senha vazia", async () => {
    const state = await login(undefined, form({ email: "a@b.co", password: "" }));
    expect(state).toEqual({ error: "Informe a senha." });
  });

  it("normaliza o e-mail antes de enviar", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    withLevels("aal1", "aal1");
    await redirectedTo(login(undefined, form({ email: " Maria@X.COM ", password: "s" })));
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "maria@x.com", password: "s" });
  });

  it("credenciais erradas e e-mail não confirmado dão a MESMA mensagem genérica", async () => {
    for (const error of [
      { status: 400, code: "invalid_credentials", message: "Invalid login credentials" },
      { status: 400, code: "email_not_confirmed", message: "Email not confirmed" },
      { status: 400, code: "user_not_found", message: "User not found" },
    ]) {
      auth.signInWithPassword.mockResolvedValue({ data: null, error });
      const state = await login(undefined, form({ email: "a@b.co", password: SECRET_PASSWORD }));
      expect(state).toEqual({ error: "E-mail ou senha incorretos." });
      expect(JSON.stringify(state)).not.toContain(SECRET_PASSWORD);
    }
  });

  it("limite de tentativas (429) vira mensagem amigável", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: null,
      error: { status: 429, code: "over_request_rate_limit", message: "rate limit" },
    });
    const state = await login(undefined, form({ email: "a@b.co", password: "x" }));
    expect(state).toEqual({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
  });

  it("depois do login segue o passo do 2FA", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    const submit = () => redirectedTo(login(undefined, form({ email: "a@b.co", password: "x" })));
    withLevels("aal1", "aal1");
    expect(await submit()).toBe("/mfa/enroll");
    withLevels("aal1", "aal2");
    expect(await submit()).toBe("/mfa/verify");
    withLevels("aal2", "aal2");
    expect(await submit()).toBe("/dashboard");
  });

  it("se não conseguir ler o nível, manda para /mfa (nunca direto ao app)", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    auth.mfa.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: null, error: new Error("x") });
    expect(await redirectedTo(login(undefined, form({ email: "a@b.co", password: "x" })))).toBe("/mfa");
  });
});

describe("startMfaEnroll", () => {
  const okEnroll = () =>
    auth.mfa.enroll.mockResolvedValue({
      data: { id: FACTOR_ID, type: "totp", totp: { qr_code: "data:image/svg+xml;utf-8,<svg/>", secret: "ABCDEF", uri: "otpauth://x" } },
      error: null,
    });

  it("sem sessão vai para /login", async () => {
    withSession(null);
    expect(await redirectedTo(startMfaEnroll())).toBe("/login");
    expect(auth.mfa.enroll).not.toHaveBeenCalled();
  });

  it("quem já tem fator verificado não pode cadastrar outro por aqui", async () => {
    withSession("aal1");
    withLevels("aal1", "aal2");
    expect(await redirectedTo(startMfaEnroll())).toBe("/mfa/verify");
    expect(auth.mfa.enroll).not.toHaveBeenCalled();
  });

  it("quem já está em aal2 vai para o dashboard", async () => {
    withSession("aal2");
    withLevels("aal2", "aal2");
    expect(await redirectedTo(startMfaEnroll())).toBe("/dashboard");
  });

  it("apaga fatores NÃO verificados antes de criar outro", async () => {
    withSession("aal1");
    withLevels("aal1", "aal1");
    okEnroll();
    auth.mfa.listFactors.mockResolvedValue({
      data: {
        all: [
          { id: "old-1", status: "unverified", factor_type: "totp" },
          { id: "old-2", status: "unverified", factor_type: "totp" },
          { id: "keep", status: "verified", factor_type: "totp" },
        ],
        totp: [],
      },
      error: null,
    });
    await startMfaEnroll();
    const removed = auth.mfa.unenroll.mock.calls.map((call) => call[0].factorId).sort();
    expect(removed).toEqual(["old-1", "old-2"]);
  });

  it("devolve QR, chave em texto e id do fator", async () => {
    withSession("aal1");
    withLevels("aal1", "aal1");
    okEnroll();
    expect(await startMfaEnroll()).toEqual({
      ok: true,
      factorId: FACTOR_ID,
      qrCode: "data:image/svg+xml;utf-8,<svg/>",
      secret: "ABCDEF",
    });
    expect(auth.mfa.enroll).toHaveBeenCalledWith(
      expect.objectContaining({ factorType: "totp", issuer: "López + Saúde" }),
    );
  });

  it("erro do Supabase vira mensagem genérica, sem vazar detalhes", async () => {
    withSession("aal1");
    withLevels("aal1", "aal1");
    auth.mfa.enroll.mockResolvedValue({ data: null, error: { message: "detalhe interno xyz" } });
    const result = await startMfaEnroll();
    expect(result).toEqual({ ok: false, error: "Não foi possível gerar o QR Code. Tente novamente." });
  });
});

describe("verifyMfaEnroll", () => {
  it("sem sessão vai para /login", async () => {
    withSession(null);
    expect(await redirectedTo(verifyMfaEnroll(undefined, form({ factorId: FACTOR_ID, code: "123456" })))).toBe("/login");
  });

  it("recusa código mal formatado sem chamar o Supabase", async () => {
    withSession("aal1");
    withLevels("aal1", "aal1");
    const state = await verifyMfaEnroll(undefined, form({ factorId: FACTOR_ID, code: "12" }));
    expect(state).toEqual({ error: "Informe o código de 6 dígitos." });
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("recusa factorId que não é UUID", async () => {
    withSession("aal1");
    withLevels("aal1", "aal1");
    const state = await verifyMfaEnroll(undefined, form({ factorId: "../../x", code: "123456" }));
    expect(state?.error).toBeTruthy();
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("não usa o cadastro quando já existe fator verificado", async () => {
    withSession("aal1");
    withLevels("aal1", "aal2");
    expect(await redirectedTo(verifyMfaEnroll(undefined, form({ factorId: FACTOR_ID, code: "123456" })))).toBe("/mfa/verify");
    expect(auth.mfa.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("código errado: mensagem genérica", async () => {
    withSession("aal1");
    withLevels("aal1", "aal1");
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { status: 400, code: "mfa_verification_failed", message: "Invalid TOTP code entered" } });
    const state = await verifyMfaEnroll(undefined, form({ factorId: FACTOR_ID, code: "123456" }));
    expect(state).toEqual({ error: "Código inválido ou expirado. Confira o app autenticador e tente de novo." });
  });

  it("código certo: valida (com espaços) e vai ao dashboard", async () => {
    withSession("aal1");
    withLevels("aal1", "aal1");
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    const to = await redirectedTo(verifyMfaEnroll(undefined, form({ factorId: FACTOR_ID, code: "123 456" })));
    expect(to).toBe("/dashboard");
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: FACTOR_ID, code: "123456" });
  });
});

describe("verifyMfaLogin", () => {
  it("sem fator cadastrado vai para o cadastro", async () => {
    withSession("aal1");
    withLevels("aal1", "aal1");
    expect(await redirectedTo(verifyMfaLogin(undefined, form({ code: "123456" })))).toBe("/mfa/enroll");
  });

  it("já em aal2 vai ao dashboard", async () => {
    withSession("aal2");
    withLevels("aal2", "aal2");
    expect(await redirectedTo(verifyMfaLogin(undefined, form({ code: "123456" })))).toBe("/dashboard");
  });

  it("recusa código mal formatado", async () => {
    withSession("aal1");
    withLevels("aal1", "aal2");
    expect(await verifyMfaLogin(undefined, form({ code: "abc" }))).toEqual({ error: "Informe o código de 6 dígitos." });
  });

  it("verifica com o fator TOTP verificado do usuário e vai ao dashboard", async () => {
    withSession("aal1");
    withLevels("aal1", "aal2");
    auth.mfa.listFactors.mockResolvedValue({
      data: { all: [], totp: [{ id: FACTOR_ID, status: "verified" }] },
      error: null,
    });
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
    expect(await redirectedTo(verifyMfaLogin(undefined, form({ code: "654321" })))).toBe("/dashboard");
    expect(auth.mfa.challengeAndVerify).toHaveBeenCalledWith({ factorId: FACTOR_ID, code: "654321" });
  });

  it("código errado e limite de tentativas têm mensagens próprias", async () => {
    withSession("aal1");
    withLevels("aal1", "aal2");
    auth.mfa.listFactors.mockResolvedValue({ data: { all: [], totp: [{ id: FACTOR_ID }] }, error: null });
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { status: 400, message: "Invalid TOTP code" } });
    expect(await verifyMfaLogin(undefined, form({ code: "000000" }))).toEqual({
      error: "Código inválido ou expirado. Confira o app autenticador e tente de novo.",
    });
    auth.mfa.challengeAndVerify.mockResolvedValue({ data: null, error: { status: 429, message: "rate" } });
    expect(await verifyMfaLogin(undefined, form({ code: "000000" }))).toEqual({
      error: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
    });
  });
});

describe("logout", () => {
  it("encerra só esta sessão e volta ao /login", async () => {
    expect(await redirectedTo(logout())).toBe("/login");
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});
