import { randomInt } from "node:crypto";

import { expect, test } from "@playwright/test";

import { fillLogin } from "./support/auth";
import {
  createFixtureUser,
  deleteAttemptsForIps,
  deleteFixtureUser,
  fixtureEmail,
  newPassword,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

// O Auth do Supabase também limita por IP: fluxos longos só no desktop (como o resto).
test.describe("limite de tentativas de login (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "somente no desktop");

  test("5 senhas erradas travam aquele e-mail naquele IP; outro IP segue livre; nada trava a conta", async ({ page }) => {
    test.setTimeout(120_000);
    // IPs de documentação (TEST-NET-3), únicos por execução: o dev confia em `x-real-ip`.
    const blockedIp = `203.0.113.${randomInt(1, 254)}`;
    const otherIp = `198.51.100.${randomInt(1, 254)}`;
    const email = fixtureEmail("limite");
    const password = newPassword();
    await createFixtureUser({ email, password, role: "reception", fullName: "Limite Fictícia" });
    try {
      await page.setExtraHTTPHeaders({ "x-real-ip": blockedIp });
      for (let attempt = 1; attempt <= 5; attempt++) {
        await fillLogin(page, email, "senha-errada-123");
        await expect(page.getByTestId("form-error"), `tentativa ${attempt}`).toHaveText("E-mail ou senha incorretos.");
      }

      // A 6ª, MESMO COM A SENHA CERTA, é barrada antes de chegar ao Supabase.
      await fillLogin(page, email, password);
      await expect(page.getByTestId("form-error")).toHaveText("Muitas tentativas. Tente novamente em 1 minuto.");
      await expect(page).toHaveURL(/\/login$/);

      // Outro e-mail no MESMO IP não é afetado (o teto do par é por e-mail)...
      const bystander = fixtureEmail("limite-outro");
      const bystanderPassword = newPassword();
      await createFixtureUser({ email: bystander, password: bystanderPassword, role: "reception", fullName: "Outro Fictício" });
      try {
        await fillLogin(page, bystander, bystanderPassword);
        await expect(page).toHaveURL(/\/mfa\/enroll$/);
      } finally {
        await deleteFixtureUser(bystander);
      }

      // ...e o MESMO e-mail vindo de outro IP entra normalmente: não há bloqueio de conta.
      await page.context().clearCookies();
      await page.setExtraHTTPHeaders({ "x-real-ip": otherIp });
      await fillLogin(page, email, password);
      await expect(page).toHaveURL(/\/mfa\/enroll$/);
    } finally {
      await deleteAttemptsForIps([blockedIp, otherIp]);
      await deleteFixtureUser(email);
    }
  });

  test("login certo perdoa as falhas anteriores do par", async ({ page }) => {
    test.setTimeout(120_000);
    const ip = `192.0.2.${randomInt(1, 254)}`;
    const email = fixtureEmail("perdao");
    const password = newPassword();
    await createFixtureUser({ email, password, role: "reception", fullName: "Perdão Fictícia" });
    try {
      await page.setExtraHTTPHeaders({ "x-real-ip": ip });
      for (let attempt = 1; attempt <= 4; attempt++) {
        await fillLogin(page, email, "senha-errada-123");
        await expect(page.getByTestId("form-error")).toHaveText("E-mail ou senha incorretos.");
      }
      await fillLogin(page, email, password); // a 5ª tentativa ainda passa (teto = 5 FALHAS) e perdoa
      await expect(page).toHaveURL(/\/mfa\/enroll$/);

      // Sem o perdão, a 5ª falha abaixo já bloquearia a 6ª tentativa; com o perdão, a conta recomeçou do zero.
      await page.context().clearCookies();
      for (let attempt = 1; attempt <= 4; attempt++) {
        await fillLogin(page, email, "senha-errada-123");
        await expect(page.getByTestId("form-error")).toHaveText("E-mail ou senha incorretos.");
      }
      await fillLogin(page, email, password);
      await expect(page).toHaveURL(/\/mfa\/enroll$/);
    } finally {
      await deleteAttemptsForIps([ip]);
      await deleteFixtureUser(email);
    }
  });
});
