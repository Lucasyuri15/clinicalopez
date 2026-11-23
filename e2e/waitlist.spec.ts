import { expect, type Page } from "@playwright/test";

import { esc } from "./support/agenda";
import { testAs } from "./support/auth";
import { catalogTag, deleteCatalog, deletePatients, deleteProfessionals, seedPatients, seedProfessionals, waitlistState } from "./support/db";
import { HAS_SUPABASE } from "./support/env";

/**
 * Lista de espera (Fase 3B-1) para admin e recepção: pôr, editar e tirar da espera, com o banco
 * confirmando o que foi gravado. O que o PROFISSIONAL não vê (menu e rota) está em `rbac.spec.ts`.
 * Cada teste cria os próprios dados etiquetados e só apaga o que leva a etiqueta. Fluxos longos: só no
 * desktop. Só dados FICTÍCIOS.
 */
function describeWaitlist(role: "admin" | "reception") {
  const test = testAs(role);
  test.describe(`perfil ${role}: lista de espera`, () => {
    test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

    let tag = "";
    let seeded: Awaited<ReturnType<typeof seedProfessionals>>;
    let patients: Awaited<ReturnType<typeof seedPatients>>;
    test.beforeEach(async () => {
      tag = catalogTag();
      seeded = await seedProfessionals(tag);
      patients = await seedPatients(tag, seeded);
    });
    test.afterEach(async () => {
      if (!tag) return;
      // Ordem: pacientes (com as esperas), profissionais, catálogo.
      await deletePatients(tag);
      await deleteProfessionals(tag);
      await deleteCatalog(tag);
      tag = "";
    });

    const card = (page: Page, patient: string) => page.getByRole("listitem").filter({ hasText: patient });

    /** Abre "Pôr na espera" e preenche paciente, serviço e profissional (o que toda espera tem). */
    async function openAndFill(page: Page, patientName: string) {
      await page.getByRole("button", { name: "Pôr na espera" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.getByLabel("Paciente", { exact: true }).fill(patientName);
      await sheet.getByRole("button", { name: new RegExp(esc(patientName)) }).click();
      await expect(sheet.getByTestId("selected-patient")).toHaveText(patientName);
      await sheet.getByLabel("Serviço", { exact: true }).selectOption({ label: `${seeded.physioService} (Fisioterapia)` });
      return sheet;
    }

    test("põe na espera com preferência, edita e tira da espera", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(120_000);
      await page.goto("/lista-espera");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lista de espera");

      // Pôr: profissional, segundas e quartas, 14:00 às 18:00 e uma observação.
      const sheet = await openAndFill(page, patients.loose.name);
      await sheet.getByLabel("Profissional", { exact: true }).selectOption({ label: seeded.own.name });
      await sheet.getByRole("checkbox", { name: "Segunda" }).check();
      await sheet.getByRole("checkbox", { name: "Quarta" }).check();
      await sheet.getByLabel("A partir das").fill("14:00");
      await sheet.getByLabel("Até as").fill("18:00");
      await sheet.getByLabel("Observação (opcional)").fill("só depois do trabalho");
      await sheet.getByRole("button", { name: "Pôr na espera" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();

      const entry = card(page, patients.loose.name);
      await expect(entry).toContainText(seeded.own.name);
      await expect(entry).toContainText("Seg e qua, 14:00–18:00");
      await expect(entry).toContainText("Obs.: só depois do trabalho");
      expect(await waitlistState(tag)).toEqual([
        {
          patient: patients.loose.name,
          service: seeded.physioService,
          professional: seeded.own.name,
          status: "waiting",
          weekdays: [1, 3],
          startMinute: 840,
          endMinute: 1080,
          note: "só depois do trabalho",
          hasClosedStamp: false,
        },
      ]);

      // Editar: troca a quarta pela sexta e limpa a observação.
      await entry.getByRole("button", { name: `Editar a espera de ${patients.loose.name}` }).click();
      const edit = page.getByRole("dialog");
      await edit.getByRole("checkbox", { name: "Quarta" }).uncheck();
      await edit.getByRole("checkbox", { name: "Sexta" }).check();
      await edit.getByLabel("Observação (opcional)").fill("");
      await edit.getByRole("button", { name: "Salvar" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(card(page, patients.loose.name)).toContainText("Seg e sex, 14:00–18:00");
      await expect(card(page, patients.loose.name)).not.toContainText("Obs.:");
      expect((await waitlistState(tag))[0]).toMatchObject({
        weekdays: [1, 5],
        note: null,
        status: "waiting",
        professional: seeded.own.name, // editar só a preferência não solta o profissional
        startMinute: 840,
        endMinute: 1080,
      });

      // Tirar: pede confirmação; cancelar não tira, confirmar tira e a espera vai para "Encerradas".
      await card(page, patients.loose.name).getByRole("button", { name: `Tirar da espera de ${patients.loose.name}` }).click();
      await card(page, patients.loose.name).getByRole("button", { name: "Cancelar" }).click();
      expect((await waitlistState(tag))[0]?.status).toBe("waiting");
      await card(page, patients.loose.name).getByRole("button", { name: `Tirar da espera de ${patients.loose.name}` }).click();
      await card(page, patients.loose.name).getByRole("button", { name: "Confirmar" }).click();
      await expect(card(page, patients.loose.name)).toHaveCount(0);
      expect((await waitlistState(tag))[0]).toMatchObject({ status: "removed", hasClosedStamp: true });

      await page.getByRole("link", { name: "Encerradas" }).click();
      await expect(page).toHaveURL(/aba=encerradas/);
      await expect(card(page, patients.loose.name)).toContainText("Retirada em");
      await expect(card(page, patients.loose.name).getByRole("button", { name: /Editar|Tirar/ })).toHaveCount(0);
    });

    test("não põe o mesmo paciente duas vezes no mesmo serviço, e a mensagem não repete o que foi digitado", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(120_000);
      await page.goto("/lista-espera");
      const first = await openAndFill(page, patients.loose.name);
      await first.getByRole("button", { name: "Pôr na espera" }).click();
      await expect(page.getByRole("dialog")).toBeHidden();
      await expect(card(page, patients.loose.name)).toContainText("Qualquer profissional · Qualquer dia e horário");

      const second = await openAndFill(page, patients.loose.name);
      await second.getByLabel("Observação (opcional)").fill("texto digitado que não deve voltar na mensagem");
      await second.getByRole("button", { name: "Pôr na espera" }).click();
      const error = second.getByRole("alert");
      await expect(error).toContainText("já está na espera");
      await expect(error).not.toContainText("texto digitado");
      // A gaveta continua aberta e o que foi digitado volta nos campos.
      await expect(second.getByLabel("Observação (opcional)")).toHaveValue("texto digitado que não deve voltar na mensagem");
      await expect(second.getByTestId("selected-patient")).toHaveText(patients.loose.name);
      await expect(second.getByLabel("Serviço", { exact: true })).toHaveValue(/.+/);
      expect(await waitlistState(tag)).toHaveLength(1);
    });

    test("faixa pela metade é recusada com mensagem, sem gravar", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(120_000);
      await page.goto("/lista-espera");
      const sheet = await openAndFill(page, patients.loose.name);
      await sheet.getByLabel("A partir das").fill("14:00");
      await sheet.getByRole("button", { name: "Pôr na espera" }).click();
      await expect(sheet.getByRole("alert")).toContainText("fim da faixa");
      expect(await waitlistState(tag)).toHaveLength(0);
    });

    test("a tela abre no celular, com título e o botão de pôr na espera", async ({ page, isMobile }) => {
      test.skip(!isMobile, "somente no celular");
      await page.goto("/lista-espera");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lista de espera");
      await expect(page.getByRole("button", { name: "Pôr na espera" })).toBeVisible();
    });
  });
}

describeWaitlist("admin");
describeWaitlist("reception");
