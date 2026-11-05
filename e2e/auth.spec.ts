import { expect, test } from "@playwright/test";

import { fillLogin, loginAndEnroll, readUsers } from "./support/auth";
import { createFixtureUser, deleteFixtureUser, fixtureEmail, newPassword } from "./support/db";
import { HAS_SUPABASE } from "./support/env";
import { codeDifferentFrom } from "./support/totp";

test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

test.describe("sem sessão", () => {
  test("as telas do app e do 2FA redirecionam para /login", async ({ page }) => {
    for (const path of ["/", "/dashboard", "/financeiro", "/pacientes/1", "/mfa", "/mfa/enroll", "/mfa/verify", "/sem-acesso", "/rota-que-nao-existe"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login$/);
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entrar");
  });

  test("a tela de login tem campos rotulados e botão", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expect(page.getByLabel("Senha")).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled();
  });

  test("senha errada e e-mail inexistente mostram a MESMA mensagem genérica", async ({ page }) => {
    const known = Object.values(readUsers())[0]!.email;

    await fillLogin(page, known, "senha-errada-123");
    const wrongPassword = await page.getByTestId("form-error").innerText();
    await expect(page).toHaveURL(/\/login$/);

    await fillLogin(page, "ninguem-existe@teste.invalid", "senha-errada-123");
    const unknownUser = await page.getByTestId("form-error").innerText();

    expect(wrongPassword).toBe("E-mail ou senha incorretos.");
    expect(unknownUser).toBe(wrongPassword);
  });

  test("campos inválidos mostram erro sem tentar entrar", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill("isto-nao-e-email");
    await page.getByLabel("Senha").fill("x");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByTestId("form-error")).toHaveText("Informe um e-mail válido.");
  });
});

// Fluxos completos: só no desktop (o Auth limita a verificação MFA a 15/min por IP).
test.describe("fluxo completo de entrada (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "somente no desktop");

  test("primeiro acesso cadastra o 2FA; depois de sair, entra com o código", async ({ page }) => {
    test.setTimeout(120_000);
    const email = fixtureEmail("fluxo");
    const password = newPassword();
    await createFixtureUser({ email, password, role: "reception", fullName: "Maria Fictícia" });
    try {
      const { secret, usedCode } = await loginAndEnroll(page, email, password);
      await expect(page.getByText("Maria Fictícia").first()).toBeVisible();
      await expect(page.getByText("Recepção", { exact: true }).first()).toBeVisible();

      await page.getByRole("button", { name: "Sair" }).first().click();
      await expect(page).toHaveURL(/\/login$/);
      await page.goto("/dashboard"); // sessão encerrada: volta ao login
      await expect(page).toHaveURL(/\/login$/);

      await fillLogin(page, email, password);
      await expect(page).toHaveURL(/\/mfa\/verify$/);
      await page.goto("/dashboard"); // senha ok, mas sem 2FA: não entra
      await expect(page).toHaveURL(/\/mfa$|\/mfa\/verify$/);

      await page.getByLabel("Código de 6 dígitos").fill("000000");
      await page.getByRole("button", { name: "Verificar" }).click();
      await expect(page.getByTestId("form-error")).toContainText("Código inválido");

      await page.getByLabel("Código de 6 dígitos").fill(await codeDifferentFrom(secret, usedCode));
      await page.getByRole("button", { name: "Verificar" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
    } finally {
      await deleteFixtureUser(email);
    }
  });

  test("usuário com 2FA mas sem perfil cai em /sem-acesso e consegue sair", async ({ page }) => {
    test.setTimeout(90_000);
    const email = fixtureEmail("semperfil");
    const password = newPassword();
    await createFixtureUser({ email, password, role: null, fullName: "Sem Perfil" });
    try {
      await loginAndEnroll(page, email, password, /\/sem-acesso$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Conta sem acesso");
      await page.goto("/dashboard"); // sem laço de redirecionamento
      await expect(page).toHaveURL(/\/sem-acesso$/);
      await page.getByRole("button", { name: "Sair" }).click();
      await expect(page).toHaveURL(/\/login$/);
    } finally {
      await deleteFixtureUser(email);
    }
  });
});
