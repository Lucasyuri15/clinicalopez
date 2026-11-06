import { expect, request as playwrightRequest, test } from "@playwright/test";

import { fillLogin, loginAndEnroll } from "./support/auth";
import {
  createFixtureUser,
  deleteFixtureUser,
  factorCounts,
  fixtureEmail,
  newPassword,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");
// Só no desktop: cadastra o 2FA (o Auth limita a verificação MFA por IP).
test.skip(({ isMobile }) => isMobile, "somente no desktop");

/**
 * Chamar uma Server Action de 2FA FORA do passo, direto por HTTP (sem a tela): a UI não é
 * confiável, cada ação revalida sessão e passo no servidor. O id da ação é capturado de um
 * cadastro legítimo e reenviado com outra sessão.
 */
test("startMfaEnroll fora do passo é recusada: só com a senha (aal1) e 2FA já cadastrado não cadastra outro fator", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const email = fixtureEmail("acao-fora-do-passo");
  const password = newPassword();
  await createFixtureUser({ email, password, role: "reception", fullName: "Fora Do Passo" });

  // Captura o id real das Server Actions chamadas em /mfa/enroll (a 1ª é a startMfaEnroll).
  const enrollActionIds: string[] = [];
  page.on("request", (req) => {
    const id = req.headers()["next-action"];
    if (req.method() === "POST" && id && new URL(req.url()).pathname === "/mfa/enroll") {
      enrollActionIds.push(id);
    }
  });

  try {
    await loginAndEnroll(page, email, password);
    const startId = enrollActionIds[0];
    expect(startId, "id da startMfaEnroll capturado").toBeTruthy();
    expect(await factorCounts(email)).toEqual({ verified: 1, unverified: 0 });

    // Sai e volta só com a senha: aal1 com fator verificado (passo "mfa-verify").
    await page.getByRole("button", { name: "Sair" }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await fillLogin(page, email, password);
    await expect(page).toHaveURL(/\/mfa\/verify$/);

    const replay = (ctx: { post: typeof context.request.post }) =>
      ctx.post(`${baseURL}/mfa/enroll`, {
        headers: {
          "next-action": startId!,
          accept: "text/x-component",
          "content-type": "text/plain;charset=UTF-8",
          origin: baseURL!,
        },
        data: "[]",
        maxRedirects: 0,
      });

    // 1) aal1 + fator verificado: a ação manda para o passo certo e NÃO cadastra fator.
    const asPasswordOnly = await replay(context.request);
    expect(asPasswordOnly.headers()["x-action-redirect"] ?? "").toMatch(/^\/mfa\/verify/);
    expect(await asPasswordOnly.text()).not.toContain("otpauth");
    expect(await factorCounts(email)).toEqual({ verified: 1, unverified: 0 });

    // 2) sem sessão nenhuma: vai para /login.
    const anonymous = await playwrightRequest.newContext();
    try {
      const response = await replay(anonymous);
      expect(response.headers()["x-action-redirect"] ?? "").toMatch(/^\/login/);
      expect(await response.text()).not.toContain("otpauth");
    } finally {
      await anonymous.dispose();
    }
    expect(await factorCounts(email)).toEqual({ verified: 1, unverified: 0 });
  } finally {
    await deleteFixtureUser(email);
  }
});
