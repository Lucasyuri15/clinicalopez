import { expect, type Page } from "@playwright/test";

import { readUsers, testAs } from "./support/auth";
import {
  catalogTag,
  consentsState,
  deleteCatalog,
  deletePatients,
  deleteProfessionals,
  patientIdByName,
  patientsState,
  seedPatients,
  seedProfessionals,
  softDeletePatient,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

/** Cartão (`<li>`) de um paciente pelo nome. */
const card = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });
const NO_CONSENT = "Sem consentimento LGPD";

/**
 * Consentimentos LGPD (1B-3b) e reativar paciente removido, para admin e recepção. O que o
 * profissional NÃO vê está em `professional-role.spec.ts` (arquivo serial: o login do profissional
 * não pode ser ligado a dois profissionais ao mesmo tempo). Cada teste cria os próprios dados
 * etiquetados e o banco confirma o que foi gravado. Só dados FICTÍCIOS.
 */
function describeConsents(role: "admin" | "reception") {
  const test = testAs(role);
  test.describe(`perfil ${role}: consentimentos LGPD`, () => {
    test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

    let tag = "";
    let seeded: Awaited<ReturnType<typeof seedProfessionals>>;
    test.beforeEach(async () => {
      tag = catalogTag();
      seeded = await seedProfessionals(tag);
    });
    test.afterEach(async () => {
      if (!tag) return;
      // Ordem: pacientes (e os consentimentos deles), profissionais, catálogo.
      await deletePatients(tag);
      await deleteProfessionals(tag);
      await deleteCatalog(tag);
      tag = "";
    });

    test("registra concessão, WhatsApp e revogação: estado atual, histórico, aviso e banco seguem", async ({ page, isMobile }, testInfo) => {
      test.skip(isMobile, "fluxo longo: só no desktop (o celular tem o teste de erro à vista abaixo)");
      test.setTimeout(90_000);
      const email = readUsers()[`${testInfo.project.name}-${role}`]?.email ?? "";
      const patients = await seedPatients(tag, seeded);
      const name = patients.own.name;
      const id = await patientIdByName(name);

      // a lista já avisa que falta o consentimento
      await page.goto("/pacientes");
      await expect(card(page, name)).toContainText(NO_CONSENT);

      await page.goto(`/pacientes/${id}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
      await expect(page.getByText(NO_CONSENT)).toBeVisible();
      const states = page.getByRole("list", { name: "Estado atual dos consentimentos" });
      await expect(states).toContainText("Tratamento de dados");
      await expect(states).toContainText("Não registrado");

      // sem escolher "concedeu ou revogou": recusa com mensagem clara, a gaveta continua aberta, nada gravado
      await page.getByRole("button", { name: `Registrar consentimento de ${name}` }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByLabel("Como foi obtido").selectOption("signed_paper");
      await sheet.getByRole("button", { name: "Registrar", exact: true }).click();
      await expect(sheet.getByTestId("form-error")).toContainText("Informe se o consentimento foi concedido ou revogado.");
      await expect(sheet.getByLabel("Como foi obtido")).toHaveValue("signed_paper"); // o escolhido volta
      expect(await consentsState(tag)).toEqual([]);

      // concede o tratamento de dados, com data anterior a hoje e uma nota
      await sheet.getByLabel("Concedeu o consentimento").check();
      await sheet.getByLabel("Data do consentimento").fill("2026-01-15");
      await sheet.getByLabel("Observação (opcional)").fill("Papel assinado na recepção");
      await sheet.getByRole("button", { name: "Registrar", exact: true }).click();
      await expect(sheet).toBeHidden();
      await expect(states).toContainText("Concedido");
      await expect(page.getByText(NO_CONSENT)).toHaveCount(0); // o aviso some
      expect(await consentsState(tag)).toEqual([
        {
          patient: name,
          kind: "data_processing",
          granted: true,
          givenBy: "patient",
          method: "signed_paper",
          occurredOn: "2026-01-15",
          note: "Papel assinado na recepção",
          registeredByEmail: email,
        },
      ]);

      // WhatsApp concedido pelo responsável, verbalmente
      await page.getByRole("button", { name: `Registrar consentimento de ${name}` }).click();
      const whatsapp = page.getByRole("dialog");
      await whatsapp.getByLabel("Tipo de consentimento").selectOption("whatsapp");
      await whatsapp.getByLabel("Concedeu o consentimento").check();
      await whatsapp.getByLabel("Quem deu o consentimento").selectOption("guardian");
      await whatsapp.getByLabel("Como foi obtido").selectOption("verbal");
      await whatsapp.getByLabel("Data do consentimento").fill("2026-02-01");
      await whatsapp.getByRole("button", { name: "Registrar", exact: true }).click();
      await expect(whatsapp).toBeHidden();
      await expect(states.getByRole("listitem").filter({ hasText: "Mensagens por WhatsApp" })).toContainText("Concedido");

      // revoga o tratamento de dados: o estado vira "Revogado" e o aviso volta
      await page.getByRole("button", { name: `Registrar consentimento de ${name}` }).click();
      const revoke = page.getByRole("dialog");
      await revoke.getByLabel("Revogou o consentimento").check();
      await revoke.getByLabel("Como foi obtido").selectOption("verbal");
      await revoke.getByLabel("Data do consentimento").fill("2026-03-01");
      await revoke.getByRole("button", { name: "Registrar", exact: true }).click();
      await expect(revoke).toBeHidden();
      await expect(states.getByRole("listitem").filter({ hasText: "Tratamento de dados" })).toContainText("Revogado");
      await expect(page.getByText(NO_CONSENT)).toBeVisible();

      // o histórico tem os três eventos, nunca editáveis
      await page.getByText("Histórico (3)").click();
      const history = page.getByRole("list", { name: "Histórico de consentimentos" });
      await expect(history.getByRole("listitem")).toHaveCount(3);
      await expect(history).toContainText("Papel assinado na recepção");
      await expect(page.getByRole("button", { name: /Editar consentimento|Apagar|Excluir/ })).toHaveCount(0);

      const saved = await consentsState(tag);
      expect(saved.map((row) => [row.kind, row.granted, row.givenBy, row.method, row.occurredOn])).toEqual([
        ["data_processing", true, "patient", "signed_paper", "2026-01-15"],
        ["whatsapp", true, "guardian", "verbal", "2026-02-01"],
        ["data_processing", false, "patient", "verbal", "2026-03-01"],
      ]);

      // a lista volta a avisar
      await page.goto("/pacientes");
      await expect(card(page, name)).toContainText(NO_CONSENT);
    });

    test("o erro de validação aparece à vista (celular incluído) e a data futura é recusada pelo servidor", async ({ page }) => {
      const patients = await seedPatients(tag, seeded);
      const name = patients.own.name;
      await page.goto(`/pacientes/${await patientIdByName(name)}`);
      await page.getByRole("button", { name: `Registrar consentimento de ${name}` }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Registrar", exact: true }).click();
      const error = sheet.getByTestId("form-error");
      await expect(error).toContainText("Informe se o consentimento foi concedido ou revogado.");
      await expect(error).toBeInViewport();

      await sheet.getByLabel("Concedeu o consentimento").check();
      await sheet.getByLabel("Como foi obtido").selectOption("digital");
      await sheet.getByLabel("Data do consentimento").evaluate((input: HTMLInputElement) => {
        input.removeAttribute("max"); // o navegador já limitaria; aqui provamos que o SERVIDOR também recusa
        input.value = "2999-01-01";
      });
      await sheet.getByRole("button", { name: "Registrar", exact: true }).click();
      await expect(sheet.getByTestId("form-error")).toContainText("A data do consentimento não pode ser no futuro.");
      // segundo erro seguido: o que foi digitado continua na tela (nada voltou ao padrão)
      await expect(sheet.getByLabel("Concedeu o consentimento")).toBeChecked();
      await expect(sheet.getByLabel("Como foi obtido")).toHaveValue("digital");
      await expect(sheet.getByLabel("Data do consentimento")).toHaveValue("2999-01-01");
      expect(await consentsState(tag)).toEqual([]);
    });

    if (role === "admin") {
      test("o admin reativa um paciente removido: volta às listas com tudo o que tinha", async ({ page, isMobile }) => {
        test.skip(isMobile, "só no desktop");
        const patients = await seedPatients(tag, seeded);
        const name = patients.loose.name;
        await softDeletePatient(name);

        // removido: some da lista normal e aparece em "Pacientes removidos"
        await page.goto("/pacientes");
        await expect(card(page, name)).toHaveCount(0);
        await page.getByRole("link", { name: "Pacientes removidos" }).click();
        await expect(page).toHaveURL(/\/pacientes\/removidos$/);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pacientes removidos");
        const row = card(page, name);
        await expect(row).toHaveCount(1);

        await row.getByText("Reativar", { exact: true }).click();
        await row.getByRole("button", { name: `Confirmar reativação de ${name}` }).click();
        await expect(card(page, name)).toHaveCount(0);
        expect((await patientsState(tag)).find((p) => p.name === name)?.removed).toBe(false);

        await page.goto("/pacientes");
        await expect(card(page, name)).toHaveCount(1);
      });
    } else {
      test("a recepção não tem o link nem abre os removidos", async ({ page, isMobile }) => {
        test.skip(isMobile, "só no desktop");
        const patients = await seedPatients(tag, seeded);
        await softDeletePatient(patients.loose.name);

        await page.goto("/pacientes");
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pacientes");
        await expect(page.getByRole("link", { name: "Pacientes removidos" })).toHaveCount(0);
        await expect(card(page, patients.loose.name)).toHaveCount(0);

        await page.goto("/pacientes/removidos");
        await expect(page).toHaveURL(/\/dashboard/);
        await expect(page.getByText(patients.loose.name)).toHaveCount(0);
      });
    }
  });
}

describeConsents("admin");
describeConsents("reception");
