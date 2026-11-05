import { describe, expect, it } from "vitest";

import { finalizeCookieOptions, sessionCookieOptions } from "./cookie-options";

describe("sessionCookieOptions", () => {
  it("cookie de sessão inacessível ao JavaScript e restrito ao mesmo site", () => {
    const options = sessionCookieOptions("production");
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("Secure em produção (HTTPS); desligado só no dev local (http)", () => {
    expect(sessionCookieOptions("production").secure).toBe(true);
    expect(sessionCookieOptions("development").secure).toBe(false);
    expect(sessionCookieOptions("test").secure).toBe(false);
  });

  it("validade de um expediente (8 h), não os 400 dias padrão da biblioteca", () => {
    expect(sessionCookieOptions("production").maxAge).toBe(8 * 60 * 60);
  });
});

describe("finalizeCookieOptions (a biblioteca força 400 dias ao gravar o cookie)", () => {
  const FOUR_HUNDRED_DAYS = 400 * 24 * 60 * 60;

  it("troca os 400 dias da biblioteca pela validade curta e impõe HttpOnly/SameSite", () => {
    const final = finalizeCookieOptions(
      { path: "/", sameSite: "lax", httpOnly: false, maxAge: FOUR_HUNDRED_DAYS },
      "production",
    );
    expect(final).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 8 * 60 * 60 });
  });

  it("mantém maxAge 0: é assim que o Supabase APAGA o cookie (logout)", () => {
    expect(finalizeCookieOptions({ path: "/", maxAge: 0 }, "production").maxAge).toBe(0);
  });

  it("preserva opções que não gerenciamos", () => {
    expect(finalizeCookieOptions({ path: "/app", domain: "exemplo.com", maxAge: FOUR_HUNDRED_DAYS }, "production")).toMatchObject({
      domain: "exemplo.com",
    });
  });
});
