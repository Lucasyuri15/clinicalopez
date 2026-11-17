import { expect, type Page } from "@playwright/test";

import { testAs } from "./support/auth";
import {
  catalogTag,
  createFixtureUser,
  deleteCatalog,
  deleteFixtureUser,
  deleteProfessionals,
  fixtureEmail,
  newPassword,
  professionalsState,
  seedCatalog,
  seedProfessionals,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

/** Cartão (`<li>`) de um profissional pelo nome. */
const card = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

// ---------------------------------------------------------------------------------------------
// Administrador: cria, edita e desativa pela tela; o banco confirma o que foi gravado.
// ---------------------------------------------------------------------------------------------
const asAdmin = testAs("admin");
asAdmin.describe("perfil admin: cadastro de profissionais", () => {
  asAdmin.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");
  asAdmin.skip(({ isMobile }) => isMobile, "somente no desktop");

  let tag = "";
  let loginEmails: string[] = [];
  asAdmin.beforeEach(() => {
    tag = catalogTag();
    loginEmails = [];
  });
  asAdmin.afterEach(async () => {
    // Em teste pulado (celular) o beforeEach não rodou e não há nada a apagar.
    if (!tag) return;
    // Ordem: profissionais (usam serviços e logins), catálogo, logins fictícios.
    await deleteProfessionals(tag);
    await deleteCatalog(tag);
    for (const email of loginEmails) await deleteFixtureUser(email);
    tag = "";
  });

  async function freeLogin(label: string): Promise<string> {
    const email = fixtureEmail(`prof-${label}`);
    loginEmails.push(email);
    await createFixtureUser({ email, password: newPassword(), role: "professional", fullName: `${tag} Login ${label}` });
    return `${tag} Login ${label}`;
  }

  asAdmin("cria com login e serviço, edita, troca de especialidade e desativa", async ({ page }) => {
    const { serviceName } = await seedCatalog(tag);
    const loginName = await freeLogin("Livre");
    const name = `${tag} Carla`;
    await page.goto("/profissionais");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Profissionais");

    // criar
    await page.getByRole("button", { name: "Novo profissional" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Nome completo").fill(name);
    await sheet.getByLabel("Especialidade").selectOption("physiotherapy");
    await expect(sheet.getByLabel("Registro profissional (CREFITO)")).toBeVisible(); // conselho derivado da especialidade
    await sheet.getByLabel("Registro profissional (CREFITO)").fill("CREFITO 33333");
    await sheet.getByLabel("Telefone").fill("(11) 91234-5678");
    await sheet.getByLabel("E-mail").fill("Carla@Clinica.Teste");
    await sheet.getByLabel("Login de acesso").selectOption({ label: loginName });
    await sheet.getByLabel(serviceName).check();
    await sheet.getByRole("button", { name: "Salvar" }).click();
    await expect(sheet).toBeHidden();

    const row = card(page, name);
    await expect(row).toContainText("Fisioterapia · CREFITO 33333");
    await expect(row).toContainText("(11) 91234-5678");
    await expect(row).toContainText("carla@clinica.teste");
    await expect(row).toContainText(loginName);
    await expect(row).toContainText(serviceName);
    expect(await professionalsState(tag)).toEqual([
      {
        name,
        specialty: "physiotherapy",
        registration: "CREFITO 33333",
        phone: "11912345678",
        email: "carla@clinica.teste",
        active: true,
        loginName,
        services: [serviceName],
      },
    ]);

    // o login já vinculado NÃO é oferecido a outro profissional
    await page.getByRole("button", { name: "Novo profissional" }).click();
    await expect(sheet.getByLabel("Login de acesso").locator("option", { hasText: loginName })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // editar: troca de especialidade zera os serviços (cada serviço é de uma especialidade só)
    await row.getByRole("button", { name: `Editar ${name}` }).click();
    await expect(sheet.getByLabel(serviceName)).toBeChecked();
    await expect(sheet.getByLabel("Login de acesso").locator("option", { hasText: loginName })).toHaveCount(1); // o atual continua
    await sheet.getByLabel("Especialidade").selectOption("dentistry");
    await expect(sheet.getByLabel(serviceName)).toHaveCount(0);
    await sheet.getByLabel("Telefone").fill("1134567890");
    await sheet.getByRole("button", { name: "Salvar" }).click();
    await expect(sheet).toBeHidden();
    await expect(card(page, name)).toContainText("(11) 3456-7890");
    const [saved] = await professionalsState(tag);
    expect(saved).toMatchObject({ specialty: "dentistry", phone: "1134567890", services: [], loginName });

    // desativar e reativar
    await card(page, name).getByRole("button", { name: `Desativar ${name}` }).click();
    await expect(card(page, name)).toContainText("Inativo");
    expect((await professionalsState(tag))[0]?.active).toBe(false);
    await card(page, name).getByRole("button", { name: `Ativar ${name}` }).click();
    await expect(card(page, name)).toContainText("Ativo");
  });

  asAdmin("erros em português, sem apagar o formulário e sem gravar", async ({ page }) => {
    await seedCatalog(tag);
    const name = `${tag} Dani`;
    await page.goto("/profissionais");
    await page.getByRole("button", { name: "Novo profissional" }).click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Nome completo").fill(name);
    await sheet.getByLabel("Especialidade").selectOption("psychology");
    await sheet.getByLabel("Telefone").fill("123");
    await sheet.getByRole("button", { name: "Salvar" }).click();
    await expect(sheet.getByTestId("form-error")).toHaveText("Informe o telefone com DDD, como (11) 91234-5678.");
    // o texto digitado e a escolha continuam
    await expect(sheet.getByLabel("Nome completo")).toHaveValue(name);
    await expect(sheet.getByLabel("Especialidade")).toHaveValue("psychology");
    await expect(sheet.getByLabel("Telefone")).toHaveValue("123");
    expect(await professionalsState(tag)).toEqual([]);

    // fechar e reabrir: nasce limpo
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await page.getByRole("button", { name: "Novo profissional" }).click();
    await expect(sheet.getByTestId("form-error")).toHaveCount(0);
    await expect(sheet.getByLabel("Nome completo")).toHaveValue("");

    // corrige e salva; um segundo com o mesmo nome e especialidade é recusado
    await sheet.getByLabel("Nome completo").fill(name);
    await sheet.getByLabel("Especialidade").selectOption("psychology");
    await sheet.getByRole("button", { name: "Salvar" }).click();
    await expect(sheet).toBeHidden();
    await page.getByRole("button", { name: "Novo profissional" }).click();
    await sheet.getByLabel("Nome completo").fill(name.toUpperCase());
    await sheet.getByLabel("Especialidade").selectOption("psychology");
    await sheet.getByRole("button", { name: "Salvar" }).click();
    await expect(sheet.getByTestId("form-error")).toHaveText(
      "Já existe um profissional com esse nome nessa especialidade.",
    );
    expect(await professionalsState(tag)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Recepção: lê todos (com contato); nenhum controle de edição.
// ---------------------------------------------------------------------------------------------
const asReception = testAs("reception");
asReception.describe("perfil recepção: só leitura dos profissionais", () => {
  asReception.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

  let tag = "";
  let seeded: Awaited<ReturnType<typeof seedProfessionals>>;
  asReception.beforeEach(async () => {
    tag = catalogTag();
    seeded = await seedProfessionals(tag);
  });
  asReception.afterEach(async () => {
    if (!tag) return;
    await deleteProfessionals(tag);
    await deleteCatalog(tag);
    tag = "";
  });

  asReception("vê todos os profissionais com contato e serviços, e nenhum controle de edição", async ({ page }) => {
    await page.goto("/profissionais");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Profissionais");
    for (const professional of [seeded.own, seeded.colleague]) {
      const row = card(page, professional.name);
      await expect(row).toContainText(professional.phoneShown);
      await expect(row).toContainText(professional.email);
      await expect(row.getByRole("button")).toHaveCount(0);
    }
    await expect(card(page, seeded.own.name)).toContainText(seeded.physioService);
    await expect(card(page, seeded.colleague.name)).toContainText(`${tag} Limpeza`);
    await expect(page.getByRole("button", { name: "Novo profissional" })).toHaveCount(0);
    // o login de acesso é assunto do admin: nem aparece para a recepção
    await expect(page.getByText("Login de acesso")).toHaveCount(0);
  });
});
