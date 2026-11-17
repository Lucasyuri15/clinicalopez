import { expect, type Page } from "@playwright/test";

import { testAs } from "./support/auth";
import { catalogState, catalogTag, deleteCatalog, seedCatalog } from "./support/db";
import { HAS_SUPABASE } from "./support/env";

const NBSP = " ";

/** Linha (`<li>`) de um item da lista pelo nome. */
const item = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

// ---------------------------------------------------------------------------------------------
// Administrador: cria e edita pela tela; o banco confirma o que foi gravado.
// ---------------------------------------------------------------------------------------------
const asAdmin = testAs("admin");
asAdmin.describe("perfil admin: serviços, convênios e valores", () => {
  asAdmin.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");
  // Só no desktop: o fluxo de edição já é longo e o Auth/DB têm limites por execução.
  asAdmin.skip(({ isMobile }) => isMobile, "somente no desktop");

  let tag: string;
  asAdmin.beforeEach(() => {
    tag = catalogTag();
  });
  asAdmin.afterEach(async () => {
    // Em teste pulado (celular) o beforeEach não rodou e não há nada a apagar.
    if (tag) await deleteCatalog(tag);
    tag = "";
  });

  asAdmin("cria um serviço, define o valor particular, edita e desativa", async ({ page }) => {
    const name = `${tag} Pilates`;
    await page.goto("/servicos");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Serviços");

    // criar (a gaveta fecha sozinha ao salvar)
    await page.getByRole("button", { name: "Novo serviço" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Nome").fill(name);
    await sheet.getByLabel("Especialidade").selectOption("physiotherapy");
    await sheet.getByLabel("Duração (minutos)").fill("45");
    await sheet.getByRole("button", { name: "Salvar" }).click();
    await expect(sheet).toBeHidden();
    await expect(item(page, name)).toContainText("45 min");

    // valor particular
    await item(page, name).getByLabel(`Valor (R$) de ${name}`).fill("R$ 150,50");
    await item(page, name).getByRole("button", { name: "Salvar valor" }).click();
    await expect(item(page, name).getByRole("status")).toHaveText("Valor salvo.");
    expect((await catalogState(tag)).services).toEqual([
      { name, durationMinutes: 45, active: true, particularCents: 15050 },
    ]);

    // editar (nome e duração)
    const renamed = `${tag} Pilates Solo`;
    await item(page, name).getByRole("button", { name: `Editar ${name}` }).click();
    await sheet.getByLabel("Nome").fill(renamed);
    await sheet.getByLabel("Duração (minutos)").fill("60");
    await sheet.getByRole("button", { name: "Salvar" }).click();
    await expect(sheet).toBeHidden();
    await expect(item(page, renamed)).toContainText("60 min");

    // desativar: continua na lista, marcado como inativo; depois reativa
    await item(page, renamed).getByRole("button", { name: `Desativar ${renamed}` }).click();
    await expect(item(page, renamed)).toContainText("Inativo");
    expect((await catalogState(tag)).services[0]).toMatchObject({ active: false, durationMinutes: 60 });
    await item(page, renamed).getByRole("button", { name: `Ativar ${renamed}` }).click();
    await expect(item(page, renamed)).toContainText("Ativo");
  });

  asAdmin("mostra erros em português e não grava entrada inválida nem duplicada", async ({ page }) => {
    const name = `${tag} Avaliacao`;
    await page.goto("/servicos");
    const sheet = page.getByRole("dialog");

    await page.getByRole("button", { name: "Novo serviço" }).click();
    await sheet.getByLabel("Nome").fill(name);
    await sheet.getByLabel("Especialidade").selectOption("dentistry");
    await sheet.getByLabel("Duração (minutos)").fill("3");
    await sheet.getByRole("button", { name: "Salvar" }).click();
    await expect(sheet.getByTestId("form-error")).toHaveText("A duração mínima é de 5 minutos.");
    expect((await catalogState(tag)).services).toEqual([]);
    // o formulário NÃO é apagado depois do erro: nome, especialidade e a duração digitada continuam
    await expect(sheet.getByLabel("Nome")).toHaveValue(name);
    await expect(sheet.getByLabel("Especialidade")).toHaveValue("dentistry");
    await expect(sheet.getByLabel("Duração (minutos)")).toHaveValue("3");

    // fechar e reabrir: nasce limpo (sem o erro nem o texto da tentativa anterior)
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await page.getByRole("button", { name: "Novo serviço" }).click();
    await expect(sheet.getByTestId("form-error")).toHaveCount(0);
    await expect(sheet.getByLabel("Nome")).toHaveValue("");
    await sheet.getByLabel("Nome").fill(name);
    await sheet.getByLabel("Especialidade").selectOption("dentistry");

    // corrige e salva; um segundo igual é recusado
    await sheet.getByLabel("Duração (minutos)").fill("30");
    await sheet.getByRole("button", { name: "Salvar" }).click();
    await expect(sheet).toBeHidden();
    await page.getByRole("button", { name: "Novo serviço" }).click();
    await sheet.getByLabel("Nome").fill(name.toUpperCase());
    await sheet.getByLabel("Especialidade").selectOption("dentistry");
    await sheet.getByLabel("Duração (minutos)").fill("30");
    await sheet.getByRole("button", { name: "Salvar" }).click();
    await expect(sheet.getByTestId("form-error")).toHaveText(
      "Já existe um serviço com esse nome nessa especialidade.",
    );
    expect((await catalogState(tag)).services).toHaveLength(1);
  });

  asAdmin("valor inválido é recusado sem gravar", async ({ page }) => {
    const { serviceName } = await seedCatalog(tag);
    await page.goto("/servicos");
    const row = item(page, serviceName);
    await row.getByLabel(`Valor (R$) de ${serviceName}`).fill("1,999");
    await row.getByRole("button", { name: "Salvar valor" }).click();
    await expect(row.getByTestId("form-error")).toHaveText("Informe um valor válido, como 150,00.");
    expect((await catalogState(tag)).services[0]?.particularCents).toBe(8765431); // não mudou
  });

  asAdmin("cria um convênio e define o valor de um serviço nele", async ({ page }) => {
    const { serviceName } = await seedCatalog(tag);
    const planName = `${tag} Plano Novo`;
    await page.goto("/convenios");
    await page.getByRole("button", { name: "Novo convênio" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Nome do plano").fill(planName);
    await sheet.getByRole("button", { name: "Salvar" }).click();
    await expect(sheet).toBeHidden();
    await expect(item(page, planName)).toBeVisible();

    await item(page, planName).getByRole("link", { name: `Ver valores de ${planName}` }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(planName);
    const row = item(page, serviceName);
    await row.getByLabel(`Valor (R$) de ${serviceName}`).fill("88,40");
    await row.getByRole("button", { name: "Salvar valor" }).click();
    await expect(row.getByRole("status")).toHaveText("Valor salvo.");
    expect((await catalogState(tag)).insurancePrices).toContainEqual({
      insurance: planName,
      service: serviceName,
      cents: 8840,
    });

    // remover o valor
    await row.getByRole("button", { name: `Remover valor de ${serviceName}` }).click();
    await expect(row.getByLabel(`Valor (R$) de ${serviceName}`)).toHaveValue("");
    expect((await catalogState(tag)).insurancePrices.filter((p) => p.insurance === planName)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Recepção: lê serviços, convênios e valores; nenhum controle de edição.
// ---------------------------------------------------------------------------------------------
const asReception = testAs("reception");
asReception.describe("perfil recepção: só leitura de serviços, convênios e valores", () => {
  asReception.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

  let tag: string;
  let seeded: Awaited<ReturnType<typeof seedCatalog>>;
  asReception.beforeEach(async () => {
    tag = catalogTag();
    seeded = await seedCatalog(tag);
  });
  asReception.afterEach(async () => {
    await deleteCatalog(tag);
  });

  asReception("vê o serviço com o valor particular e nenhum controle de edição", async ({ page }) => {
    await page.goto("/servicos");
    const row = item(page, seeded.serviceName);
    await expect(row).toContainText("50 min");
    await expect(row).toContainText(`R$${NBSP}87.654,31`);
    await expect(page.getByRole("button", { name: "Novo serviço" })).toHaveCount(0);
    await expect(row.getByRole("button")).toHaveCount(0);
    await expect(row.getByRole("textbox")).toHaveCount(0);
  });

  asReception("vê o convênio e os valores dele, sem editar", async ({ page }) => {
    await page.goto("/convenios");
    await expect(page.getByRole("button", { name: "Novo convênio" })).toHaveCount(0);
    await item(page, seeded.insuranceName).getByRole("link", { name: /Ver valores/ }).click();
    const row = item(page, seeded.serviceName);
    await expect(row).toContainText(`R$${NBSP}76.543,21`);
    await expect(row.getByRole("button")).toHaveCount(0);
    await expect(row.getByRole("textbox")).toHaveCount(0);
  });

  asReception("convênio inexistente mostra a página de não encontrado", async ({ page }) => {
    await page.goto("/convenios/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Não encontrado");
  });
});

// ---------------------------------------------------------------------------------------------
// Profissional: vê serviços, NUNCA valores nem convênios (nem escondidos no HTML).
// ---------------------------------------------------------------------------------------------
const asProfessional = testAs("professional");
asProfessional.describe("perfil profissional: serviços sem valores", () => {
  asProfessional.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

  let tag: string;
  let seeded: Awaited<ReturnType<typeof seedCatalog>>;
  asProfessional.beforeEach(async () => {
    tag = catalogTag();
    seeded = await seedCatalog(tag);
  });
  asProfessional.afterEach(async () => {
    await deleteCatalog(tag);
  });

  asProfessional("vê nome e duração e nenhum valor, nem no código da página", async ({ page }) => {
    await page.goto("/servicos");
    const row = item(page, seeded.serviceName);
    await expect(row).toContainText("50 min");
    await expect(row.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Novo serviço" })).toHaveCount(0);

    // Nenhum valor na tela...
    await expect(page.locator("main")).not.toContainText("R$");
    // ...nem no HTML entregue (inclui os dados que o Next embute para hidratar a página).
    const html = await page.content();
    // (valores de 7 dígitos, improváveis de aparecer em ids/hashes do HTML por acaso)
    expect(html).not.toContain("87.654,31");
    expect(html).not.toContain("8765431");
    expect(html).not.toContain("7654321");
    expect(html).not.toContain(seeded.insuranceName);
  });

  asProfessional("não acessa convênios nem os valores de um convênio", async ({ page }) => {
    await page.goto("/convenios");
    await expect(page).toHaveURL(/\/dashboard\?acesso=negado$/);
    await page.goto(`/convenios/${seeded.insuranceId}`);
    await expect(page).toHaveURL(/\/dashboard\?acesso=negado$/);
  });
});
