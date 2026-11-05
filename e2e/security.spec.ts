import { expect, test } from "@playwright/test";

import { fillLogin, testAs } from "./support/auth";
import { watchCsp } from "./support/csp";
import { createFixtureUser, deleteFixtureUser, fixtureEmail, newPassword } from "./support/db";
import { HAS_SUPABASE } from "./support/env";
import { currentCode } from "./support/totp";

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

test.describe("Content-Security-Policy com nonce (rota pública /login)", () => {
  test("a resposta traz CSP estrita e todo <script> leva o nonce do cabeçalho", async ({ request }) => {
    const response = await request.get("/login");
    const csp = response.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce, "nonce na CSP").toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);

    const html = await response.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    // Se o shell fosse estático (cacheComponents), parte dos scripts viria sem nonce.
    const withoutNonce = scripts.filter((tag) => !tag.includes(`nonce="${nonce}"`));
    expect(withoutNonce, "scripts sem o nonce desta resposta").toEqual([]);
  });

  test("cada requisição recebe um nonce novo", async ({ request }) => {
    const nonceOf = async () =>
      /'nonce-([^']+)'/.exec((await request.get("/login")).headers()["content-security-policy"] ?? "")?.[1];
    const [a, b] = [await nonceOf(), await nonceOf()];
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  test("redirecionamentos também carregam a CSP", async ({ request }) => {
    const response = await request.get("/dashboard", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers()["content-security-policy"]).toContain("'nonce-");
  });

  test("o navegador carrega e hidrata /login sem violações", async ({ page }) => {
    const csp = watchCsp(page);
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    // Só funciona se o React hidratou: a ação de servidor roda e devolve o erro genérico.
    await page.getByLabel("E-mail").fill("ninguem@teste.invalid");
    await page.getByLabel("Senha").fill("senha-que-nao-existe-123");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByTestId("form-error")).toBeVisible();
    expect(csp.violations).toEqual([]);
  });
});

// Cadastro do 2FA (QR em data:) com um usuário novo. Só no desktop: o Auth limita a
// verificação MFA a 15/min por IP.
test.describe("CSP no cadastro do 2FA (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "somente no desktop");

  test("o QR Code (data:) aparece e não há violações até chegar ao app", async ({ page }) => {
    test.setTimeout(120_000);
    const email = fixtureEmail("csp");
    const password = newPassword();
    await createFixtureUser({ email, password, role: "reception", fullName: "Csp Fictícia" });
    try {
      const csp = watchCsp(page);
      await fillLogin(page, email, password);
      await expect(page).toHaveURL(/\/mfa\/enroll$/);
      await page.getByRole("button", { name: "Gerar QR Code" }).click();
      const qr = page.locator('img[src^="data:image/svg+xml"]');
      await expect(qr).toBeVisible();
      // `visible` não prova que carregou: uma imagem bloqueada pela CSP continua no DOM.
      await expect.poll(() => qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

      const secret = (await page.getByTestId("mfa-secret").innerText()).replace(/\s+/g, "");
      await page.getByLabel("Código de 6 dígitos").fill(currentCode(secret));
      await page.getByRole("button", { name: "Confirmar e entrar" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      await page.waitForLoadState("networkidle");
      expect(csp.violations).toEqual([]);
    } finally {
      await deleteFixtureUser(email);
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

  authed("telas autenticadas carregam sem violações de CSP", async ({ page }) => {
    const csp = watchCsp(page);
    for (const path of ["/dashboard", "/agenda", "/pacientes", "/configuracoes"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    }
    expect(csp.violations).toEqual([]);
  });

  authed("mantêm os cabeçalhos de segurança e o noindex", async ({ page }) => {
    const response = await page.goto("/dashboard");
    const headers = response?.headers() ?? {};
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-robots-tag"]).toContain("noindex");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});
