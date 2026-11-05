import { expect, test } from "@playwright/test";

import { testAs } from "./support/auth";
import { HAS_SUPABASE } from "./support/env";

test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

test.describe("linha de base de segurança (rota pública /login)", () => {
  test("responde com cabeçalhos de segurança", async ({ request }) => {
    const response = await request.get("/login");
    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["permissions-policy"]).toContain("microphone=()");
    expect(headers["strict-transport-security"]).toContain("max-age=");
  });

  test("não se identifica como Next.js", async ({ request }) => {
    expect((await request.get("/login")).headers()["x-powered-by"]).toBeUndefined();
  });

  test("bloqueia indexação por buscadores", async ({ request, page }) => {
    expect((await request.get("/login")).headers()["x-robots-tag"]).toContain("noindex");

    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toMatch(/Disallow:\s*\//);

    await page.goto("/login");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });

  test("rotas do app sem sessão respondem com redirecionamento, nunca com conteúdo", async ({ request }) => {
    for (const path of ["/dashboard", "/pacientes", "/financeiro", "/mfa/verify"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(307);
      // O Next devolve o destino relativo (`/login`): resolve contra uma base só para comparar.
      expect(new URL(response.headers()["location"] ?? "", "http://localhost").pathname, path).toBe("/login");
      expect(await response.text(), path).not.toContain("Agenda");
    }
  });
});

test("assets públicos (logo e robots) não exigem login, mas só os exatos", async ({ request }) => {
  expect((await request.get("/brand/logo.png")).status()).toBe(200);
  expect((await request.get("/robots.txt")).status()).toBe(200);
  // nomes parecidos NÃO escapam do proxy: sem sessão, redirecionam ao login
  const lookalike = await request.get("/robots.txtX", { maxRedirects: 0 });
  expect(lookalike.status()).toBe(307);
});

const authed = testAs("admin");
authed.describe("rotas autenticadas", () => {
  authed("o cookie de sessão é HttpOnly, SameSite=Lax e de curta duração", async ({ page }) => {
    await page.goto("/dashboard");
    const cookies = (await page.context().cookies()).filter((c) => /^sb-.*-auth-token/.test(c.name));
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie.httpOnly, cookie.name).toBe(true);
      expect(cookie.sameSite, cookie.name).toBe("Lax");
      const lifetime = cookie.expires - Date.now() / 1000;
      expect(lifetime, cookie.name).toBeGreaterThan(0);
      expect(lifetime, cookie.name).toBeLessThanOrEqual(8 * 60 * 60 + 60);
    }
  });

  authed("mantêm os cabeçalhos de segurança e o noindex", async ({ page }) => {
    const response = await page.goto("/dashboard");
    const headers = response?.headers() ?? {};
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-robots-tag"]).toContain("noindex");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});
