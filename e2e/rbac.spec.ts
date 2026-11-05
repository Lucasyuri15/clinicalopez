import { expect, type Page } from "@playwright/test";

import { testAs } from "./support/auth";
import type { Role } from "./support/db";
import { HAS_SUPABASE } from "./support/env";

const ALL = ["Dashboard", "Agenda", "Pacientes", "Profissionais", "Serviços", "Financeiro", "Configurações"];

const EXPECTED: Record<Role, { visible: string[]; denied: string[] }> = {
  admin: { visible: ALL, denied: [] },
  reception: {
    visible: ["Dashboard", "Agenda", "Pacientes", "Financeiro"],
    denied: ["/profissionais", "/servicos", "/configuracoes"],
  },
  professional: {
    visible: ["Dashboard", "Agenda", "Pacientes"],
    denied: ["/profissionais", "/servicos", "/financeiro", "/configuracoes"],
  },
};

/** Links do menu: na barra lateral (desktop) ou na gaveta (celular). */
async function menuLinks(page: Page, isMobile: boolean): Promise<string[]> {
  let scope = page.getByRole("navigation", { name: "Principal" });
  if (isMobile) {
    await page.getByRole("button", { name: "Abrir menu" }).click();
    scope = page.getByRole("dialog").getByRole("navigation", { name: "Principal" });
  }
  await expect(scope).toBeVisible();
  return scope.getByRole("link").allInnerTexts();
}

for (const role of ["admin", "reception", "professional"] as const) {
  const test = testAs(role);
  test.describe(`perfil ${role}`, () => {
    test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

    test("o menu mostra só as telas permitidas", async ({ page, isMobile }) => {
      await page.goto("/dashboard");
      const links = await menuLinks(page, isMobile);
      expect(links.map((text) => text.trim())).toEqual(EXPECTED[role].visible);
    });

    for (const path of EXPECTED[role].denied) {
      test(`acessar ${path} direto volta ao dashboard com aviso`, async ({ page }) => {
        await page.goto(path);
        await expect(page).toHaveURL(/\/dashboard\?acesso=negado$/);
        await expect(page.getByRole("status").filter({ hasText: "Você não tem acesso" })).toBeVisible();
      });
    }
  });
}
