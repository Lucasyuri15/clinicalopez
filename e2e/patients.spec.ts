import { expect, type Page } from "@playwright/test";

import { testAs } from "./support/auth";
import {
  catalogTag,
  deleteCatalog,
  deletePatients,
  deleteProfessionals,
  fakeCpf,
  formatCpfDigits,
  patientIdByName,
  patientsState,
  seedPatients,
  seedProfessionals,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

/** Cartão (`<li>`) de um paciente pelo nome. */
const card = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

/**
 * Pacientes: a recepção cadastra, edita e inativa; o admin também remove. Cada teste cria os
 * próprios dados etiquetados (`[e2e-cat xxxx]`) e o banco confirma o que foi gravado. Só dados
 * FICTÍCIOS (CPFs gerados com dígitos válidos).
 */
function describePatients(role: "admin" | "reception") {
  const test = testAs(role);
  test.describe(`perfil ${role}: cadastro de pacientes`, () => {
    test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

    let tag = "";
    let seeded: Awaited<ReturnType<typeof seedProfessionals>>;
    test.beforeEach(async () => {
      tag = catalogTag();
      seeded = await seedProfessionals(tag);
    });
    test.afterEach(async () => {
      if (!tag) return;
      // Ordem: pacientes (usam profissionais e convênios), profissionais, catálogo.
      await deletePatients(tag);
      await deleteProfessionals(tag);
      await deleteCatalog(tag);
      tag = "";
    });

    test("cadastra, não repete CPF, edita, inativa e busca", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop (o celular tem o teste de erro à vista abaixo)");
      test.setTimeout(90_000); // cadastro, duplicado, edição, inativação e várias buscas num só teste
      const name = `${tag} Maria Nova`;
      const cpf = fakeCpf();
      await page.goto("/pacientes");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pacientes");

      // uma busca SEM resultado na tela: depois de cadastrar, ela recomeça e o novo paciente aparece
      await page.getByLabel("Buscar paciente").fill("zzzz nao existe");
      await page.getByRole("button", { name: "Buscar" }).click();
      await expect(page.getByText("Nenhum paciente encontrado para essa busca.")).toBeVisible();

      // cadastrar com um profissional vinculado
      await page.getByRole("button", { name: "Novo paciente" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByLabel("Nome completo").fill(name);
      await sheet.getByLabel("Data de nascimento").fill("1990-05-10");
      await sheet.getByLabel("Telefone / WhatsApp").fill("(11) 91234-5678");
      await sheet.getByLabel("CPF", { exact: true }).fill(formatCpfDigits(cpf));
      await sheet.getByLabel("CEP").fill("01310-100");
      await sheet.getByLabel("Logradouro").fill("Rua Fictícia");
      await sheet.getByLabel("UF").selectOption("SP");
      await sheet.getByLabel(`${seeded.own.name} · Fisioterapia`).check();
      await sheet.getByRole("button", { name: "Salvar" }).click();
      await expect(sheet).toBeHidden();

      const row = card(page, name);
      await expect(page.getByText("Nenhum paciente encontrado para essa busca.")).toBeHidden();
      await expect(row).toContainText("10/05/1990");
      await expect(row).toContainText("(11) 91234-5678");
      expect(await patientsState(tag)).toEqual([
        {
          name,
          birthDate: "1990-05-10",
          phone: "11912345678",
          active: true,
          removed: false,
          cpf,
          noCpfReason: null,
          street: "Rua Fictícia",
          guardianName: null,
          professionals: [seeded.own.name],
        },
      ]);

      // o mesmo CPF em outro nome: recusado com mensagem clara, a gaveta continua aberta, nada gravado
      await page.getByRole("button", { name: "Novo paciente" }).click();
      const again = page.getByRole("dialog");
      await again.getByLabel("Nome completo").fill(`${tag} Outra Pessoa`);
      await again.getByLabel("Data de nascimento").fill("1991-01-01");
      await again.getByLabel("Telefone / WhatsApp").fill("(11) 98888-7777");
      await again.getByLabel("CPF", { exact: true }).fill(cpf);
      await again.getByRole("button", { name: "Salvar" }).click();
      await expect(again.getByTestId("form-error")).toContainText("Já existe um cadastro com este CPF");
      await expect(again.getByLabel("Nome completo")).toHaveValue(`${tag} Outra Pessoa`); // o digitado volta
      expect(await patientsState(tag)).toHaveLength(1);
      await page.keyboard.press("Escape");
      await expect(again).toBeHidden();

      // abrir, editar telefone e trocar o vínculo
      await row.getByRole("link", { name: `Abrir cadastro de ${name}` }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
      await expect(page.getByText(formatCpfDigits(cpf))).toBeVisible();
      await expect(page.getByText("Rua Fictícia")).toBeVisible();
      await page.getByRole("button", { name: `Editar ${name}` }).click();
      const edit = page.getByRole("dialog");
      await edit.getByLabel("Telefone / WhatsApp").fill("(21) 92222-3333");
      await edit.getByLabel(`${seeded.own.name} · Fisioterapia`).uncheck();
      await edit.getByLabel(`${seeded.colleague.name} · Odontologia`).check();
      await edit.getByRole("button", { name: "Salvar" }).click();
      await expect(edit).toBeHidden();
      await expect(page.getByText("(21) 92222-3333")).toBeVisible();
      const [saved] = await patientsState(tag);
      expect(saved).toMatchObject({ phone: "21922223333", cpf, professionals: [seeded.colleague.name] });

      // inativar
      await page.getByRole("button", { name: `Desativar ${name}` }).click();
      await expect(page.getByText("Inativo")).toBeVisible();
      expect((await patientsState(tag))[0]?.active).toBe(false);

      // buscar. Cada resultado POSITIVO vem logo depois de um NEGATIVO: assim a asserção só passa
      // depois que a resposta da busca chegou (a lista inicial já mostraria o mesmo cartão).
      const search = page.getByLabel("Buscar paciente");
      const none = page.getByText("Nenhum paciente encontrado para essa busca.");
      await page.goto("/pacientes");
      await search.fill("zzzz nao existe");
      await page.getByRole("button", { name: "Buscar" }).click();
      await expect(none).toBeVisible();

      // por nome, sem acento e sem diferenciar maiúsculas
      await search.fill(`${tag} MARIA nova`.toLowerCase());
      await page.getByRole("button", { name: "Buscar" }).click();
      await expect(none).toBeHidden();
      await expect(card(page, name)).toHaveCount(1);

      // por CPF: um errado não acha; o certo (formatado) acha
      await search.fill("000.000.000-00");
      await page.getByRole("button", { name: "Buscar" }).click();
      await expect(none).toBeVisible();
      await search.fill(formatCpfDigits(cpf));
      await page.getByRole("button", { name: "Buscar" }).click();
      await expect(none).toBeHidden();
      await expect(card(page, name)).toHaveCount(1);

      // o termo (CPF ou nome) fica só na tela: a busca é POST, nunca vai para a URL
      expect(page.url()).not.toContain("q=");
      expect(page.url()).not.toContain(cpf);
    });

    test("o erro de validação aparece à vista, mesmo no formulário longo (celular incluído)", async ({ page }) => {
      await page.goto("/pacientes");
      await page.getByRole("button", { name: "Novo paciente" }).click();
      const sheet = page.getByRole("dialog");
      // preenche só o começo e rola até o botão: a mensagem nasce no topo, fora de vista
      await sheet.getByLabel("Nome completo").fill(`${tag} Sem Dados`);
      await sheet.getByRole("button", { name: "Salvar" }).click();
      const error = sheet.getByTestId("form-error");
      await expect(error).toContainText("Informe a data de nascimento.");
      await expect(error).toBeInViewport();
      expect(await patientsState(tag)).toEqual([]);
    });

    test("'Sem CPF' pede o motivo; menor de idade pede o responsável", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      await page.goto("/pacientes");
      await page.getByRole("button", { name: "Novo paciente" }).click();
      const sheet = page.getByRole("dialog");
      const name = `${tag} Sem Cpf`;
      await sheet.getByLabel("Nome completo").fill(name);
      await sheet.getByLabel("Data de nascimento").fill("2018-01-01"); // menor de 18 anos
      await sheet.getByLabel("E-mail").fill("responsavel@teste.invalid");

      // marcar "Sem CPF": o campo do CPF some e aparece o do motivo
      await sheet.getByLabel("Sem CPF (por exemplo, paciente estrangeiro)").check();
      await expect(sheet.getByLabel("CPF", { exact: true })).toHaveCount(0);
      await expect(sheet.getByLabel("Motivo de não ter CPF")).toBeVisible();
      await expect(sheet.getByTestId("guardian-help")).toContainText("menor de 18 anos");

      // sem motivo e sem responsável: recusa com a primeira mensagem
      await sheet.getByRole("button", { name: "Salvar" }).click();
      await expect(sheet.getByTestId("form-error")).toContainText("Informe o motivo de não ter CPF.");
      expect(await patientsState(tag)).toEqual([]);

      await sheet.getByLabel("Motivo de não ter CPF").fill("Criança estrangeira, ainda sem CPF");
      await sheet.getByRole("button", { name: "Salvar" }).click();
      await expect(sheet.getByTestId("form-error")).toContainText("responsável");
      expect(await patientsState(tag)).toEqual([]);

      await sheet.getByLabel("Nome do responsável").fill(`${tag} Mae Teste`);
      await sheet.getByLabel("Parentesco").fill("Mãe");
      await sheet.getByLabel("Telefone do responsável").fill("(11) 97777-6666");
      await sheet.getByRole("button", { name: "Salvar" }).click();
      await expect(sheet).toBeHidden();

      expect(await patientsState(tag)).toEqual([
        expect.objectContaining({
          name,
          cpf: null,
          noCpfReason: "Criança estrangeira, ainda sem CPF",
          guardianName: `${tag} Mae Teste`,
        }),
      ]);
    });

    if (role === "admin") {
      test("só o admin remove: some das listas e a página deixa de existir", async ({ page, isMobile }) => {
        test.skip(isMobile, "só no desktop");
        const seededPatients = await seedPatients(tag, seeded);
        const id = await patientIdByName(seededPatients.loose.name);
        await page.goto(`/pacientes/${id}`);
        await page.getByText("Remover paciente", { exact: true }).click();
        await page.getByRole("button", { name: `Confirmar remoção de ${seededPatients.loose.name}` }).click();
        await expect(page).toHaveURL(/\/pacientes$/);
        await expect(card(page, seededPatients.loose.name)).toHaveCount(0);
        const state = await patientsState(tag);
        expect(state.find((p) => p.name === seededPatients.loose.name)?.removed).toBe(true);
        await page.goto(`/pacientes/${id}`);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Não encontrado");
      });
    } else {
      test("a recepção não tem o botão de remover", async ({ page, isMobile }) => {
        test.skip(isMobile, "só no desktop");
        const seededPatients = await seedPatients(tag, seeded);
        const id = await patientIdByName(seededPatients.own.name);
        await page.goto(`/pacientes/${id}`);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(seededPatients.own.name);
        await expect(page.getByText("Remover paciente")).toHaveCount(0);
        await expect(page.getByRole("button", { name: /Confirmar remoção/ })).toHaveCount(0);
        await expect(page.getByRole("button", { name: `Editar ${seededPatients.own.name}` })).toBeVisible();
      });
    }
  });
}

describePatients("admin");
describePatients("reception");
