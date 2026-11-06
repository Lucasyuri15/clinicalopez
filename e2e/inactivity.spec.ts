import { expect, test, type BrowserContext } from "@playwright/test";

import { fillLogin, loginAndEnroll } from "./support/auth";
import { createFixtureUser, deleteFixtureUser, fixtureEmail, newPassword } from "./support/db";
import { HAS_SUPABASE } from "./support/env";

test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");
// Só no desktop: cadastra o 2FA (o Auth limita a verificação MFA por IP).
test.skip(({ isMobile }) => isMobile, "somente no desktop");

const MIN = 60 * 1000;

async function cookieNames(context: BrowserContext) {
  return (await context.cookies()).map((cookie) => cookie.name);
}

/**
 * O prazo é conferido no SERVIDOR (o `proxy`), então o relógio do navegador não ajuda:
 * envelhecemos o cookie de atividade, que é o que o servidor lê.
 */
async function ageActivity(context: BrowserContext, minutesAgo: number) {
  const cookie = (await context.cookies()).find((c) => c.name === "ls_activity");
  expect(cookie, "cookie ls_activity").toBeDefined();
  await context.addCookies([{ ...cookie!, value: String(Date.now() - minutesAgo * MIN) }]);
}

test("30 min sem atividade encerram a sessão; antes disso, não", async ({ page, context }) => {
  test.setTimeout(120_000);
  const email = fixtureEmail("inativo");
  const password = newPassword();
  await createFixtureUser({ email, password, role: "reception", fullName: "Inativa Fictícia" });
  try {
    await loginAndEnroll(page, email, password);

    // O cookie de atividade existe e o JavaScript não consegue lê-lo.
    const activity = (await context.cookies()).find((c) => c.name === "ls_activity");
    expect(activity).toMatchObject({ httpOnly: true, sameSite: "Lax" });

    // 29 min parado: continua logado e o prazo é renovado.
    await ageActivity(context, 29);
    await page.goto("/agenda");
    await expect(page).toHaveURL(/\/agenda$/);
    const renewed = (await context.cookies()).find((c) => c.name === "ls_activity");
    expect(Date.now() - Number(renewed?.value)).toBeLessThan(MIN);

    // 31 min parado: volta ao login e os cookies somem.
    await ageActivity(context, 31);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    const names = await cookieNames(context);
    expect(names.filter((name) => name === "ls_activity" || name.startsWith("sb-"))).toEqual([]);

    // Continua fora, e um novo login não herda o prazo vencido.
    await page.goto("/agenda");
    await expect(page).toHaveURL(/\/login$/);
    await fillLogin(page, email, password);
    await expect(page).toHaveURL(/\/mfa\/verify$/);
  } finally {
    await deleteFixtureUser(email);
  }
});

test("Server Action depois de 31 min parado (clicar em Sair) cai no /login, sem erro", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const email = fixtureEmail("inativo-acao");
  const password = newPassword();
  await createFixtureUser({ email, password, role: "reception", fullName: "Acao Fictícia" });
  try {
    await loginAndEnroll(page, email, password);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await ageActivity(context, 31);
    await page.getByRole("button", { name: "Sair" }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Entrar");
    expect(errors).toEqual([]);

    const names = await cookieNames(context);
    expect(names.filter((name) => name === "ls_activity" || name.startsWith("sb-"))).toEqual([]);
  } finally {
    await deleteFixtureUser(email);
  }
});
