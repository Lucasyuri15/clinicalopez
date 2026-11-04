import { expect, test } from "@playwright/test";

const PAGES = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Agenda", href: "/agenda" },
  { label: "Pacientes", href: "/pacientes" },
  { label: "Profissionais", href: "/profissionais" },
  { label: "Serviços", href: "/servicos" },
  { label: "Financeiro", href: "/financeiro" },
  { label: "Configurações", href: "/configuracoes" },
] as const;

test("a raiz redireciona para o dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
});

test.describe("desktop", () => {
  test.skip(({ isMobile }) => isMobile, "somente no desktop");

  test("a barra lateral navega por todas as telas", async ({ page }) => {
    await page.goto("/dashboard");
    const nav = page.getByRole("navigation", { name: "Principal" });
    await expect(nav).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Abrir menu" }),
    ).toBeHidden();

    for (const { label, href } of PAGES) {
      await nav.getByRole("link", { name: label }).click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(label);
      await expect(nav.getByRole("link", { name: label })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
  });
});

test.describe("celular", () => {
  test.skip(({ isMobile }) => !isMobile, "somente no celular");

  test("o menu em gaveta abre, navega e fecha", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(
      page.getByRole("navigation", { name: "Principal" }),
    ).toBeHidden();

    await page.getByRole("button", { name: "Abrir menu" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();

    await drawer.getByRole("link", { name: "Agenda" }).click();
    await expect(page).toHaveURL(/\/agenda$/);
    await expect(drawer).toBeHidden();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Agenda");
  });
});

test("o link 'Pular para o conteúdo' leva ao conteúdo principal", async ({
  page,
}) => {
  await page.goto("/dashboard");
  const skip = page.getByRole("link", { name: "Pular para o conteúdo" });
  await skip.focus();
  await expect(skip).toBeVisible();
  await skip.press("Enter");
  await expect(page).toHaveURL(/#conteudo$/);
});
