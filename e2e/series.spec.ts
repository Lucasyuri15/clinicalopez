import { expect, type Page } from "@playwright/test";

import { brtInstant, esc, freeMondays } from "./support/agenda";
import { readUsers, testAs } from "./support/auth";
import {
  catalogTag,
  deleteCatalog,
  deletePatients,
  deleteProfessionals,
  professionalIdByName,
  profileIdByEmail,
  seedAppointment,
  seedPatients,
  seedProfessionals,
  seedSchedule,
  seedSeries,
  seriesSessions,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

/** O botão (cartão) de um atendimento pelo trecho do rótulo ("09:00–09:50, Paciente, Serviço, Situação…"). */
const appointment = (page: Page, text: string | RegExp) => page.getByRole("button", { name: text });

/**
 * Séries e pacotes de sessões (Fase 3A) para admin e recepção. O que o PROFISSIONAL NÃO vê está em
 * `professional-role.spec.ts` (arquivo serial). Cada teste cria os próprios dados etiquetados e o
 * banco confirma o que foi gravado. A tela é aberta já filtrada por profissional. Fluxos longos: só
 * no desktop. Só dados FICTÍCIOS.
 */
function describeSeries(role: "admin" | "reception") {
  const test = testAs(role);
  test.describe(`perfil ${role}: séries de sessões`, () => {
    test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

    let tag = "";
    let seeded: Awaited<ReturnType<typeof seedProfessionals>>;
    let patients: Awaited<ReturnType<typeof seedPatients>>;
    let mondays: string[] = [];
    let createdBy = "";
    let ownId = "";
    test.beforeEach(async ({}, testInfo) => {
      tag = catalogTag();
      seeded = await seedProfessionals(tag);
      await seedSchedule(seeded);
      patients = await seedPatients(tag, seeded);
      mondays = freeMondays(4);
      createdBy = await profileIdByEmail(readUsers()[`${testInfo.project.name}-${role}`]?.email ?? "");
      ownId = await professionalIdByName(seeded.own.name);
    });
    test.afterEach(async () => {
      if (!tag) return;
      // Ordem: pacientes (com as séries e os atendimentos), profissionais, catálogo.
      await deletePatients(tag);
      await deleteProfessionals(tag);
      await deleteCatalog(tag);
      tag = "";
    });

    const weekUrl = (date = mondays[0]!) => `/agenda?view=week&date=${date}&professional=${ownId}`;
    const physio = () => seeded.physioService;
    /** A sessão de segunda às 09:00 de um paciente, pelo trecho do rótulo. */
    // (o paciente de teste não tem consentimento LGPD: o rótulo traz ", sem consentimento LGPD" no meio)
    const session = (page: Page, patient: string, extra: string) =>
      appointment(page, new RegExp(`09:00–09:50, ${esc(patient)}, ${esc(physio())}, Agendada.*${esc(extra)}`));

    /** Abre "Agendar", escolhe o paciente, o serviço e o horário (os campos comuns às duas formas de agendar). */
    async function fillBooking(page: Page, patientName: string) {
      await page.getByRole("button", { name: "Agendar", exact: true }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByLabel("Paciente", { exact: true }).fill(patientName);
      await sheet.getByRole("button", { name: new RegExp(esc(patientName)) }).click();
      await expect(sheet.getByTestId("selected-patient")).toHaveText(patientName);
      await sheet.getByLabel("Serviço", { exact: true }).selectOption({ label: `${physio()} (50 min)` });
      await sheet.getByLabel("Horário de início").fill("09:00");
      return sheet;
    }

    test("cria uma série pela prévia: 3 segundas às 09:00, com selo e andamento na agenda", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(120_000);
      await page.goto(weekUrl());
      const sheet = await fillBooking(page, patients.loose.name);

      await sheet.getByLabel("Repetir semanalmente (série de sessões)").check();
      // O dia da semana da data escolhida já vem marcado.
      await expect(sheet.getByRole("checkbox", { name: "Segunda-feira" })).toBeChecked();
      await sheet.getByLabel("Número de sessões").fill("3");
      // Sem prévia não há botão de criar.
      await expect(sheet.getByRole("button", { name: /^Criar / })).toHaveCount(0);
      await sheet.getByRole("button", { name: "Ver prévia" }).click();

      await expect(sheet.getByRole("status").filter({ hasText: "datas cabem" })).toHaveText("3 de 3 datas cabem.");
      await expect(sheet.getByRole("region", { name: "Prévia da série" }).getByRole("listitem")).toHaveCount(3);
      // Alternar "Repetir" depois da prévia não apaga o que foi digitado (horário, paciente).
      await sheet.getByLabel("Repetir semanalmente (série de sessões)").uncheck();
      await expect(sheet.getByLabel("Horário de início")).toHaveValue("09:00");
      await expect(sheet.getByTestId("selected-patient")).toHaveText(patients.loose.name);
      await sheet.getByLabel("Repetir semanalmente (série de sessões)").check();
      // Mexer nos dados deixa a prévia velha: criar some até ver a prévia de novo.
      await sheet.getByLabel("Número de sessões").fill("2");
      await expect(sheet.getByRole("button", { name: /^Criar / })).toHaveCount(0);
      await expect(sheet).toContainText("Veja a prévia de novo");
      await sheet.getByLabel("Número de sessões").fill("3");
      await sheet.getByRole("button", { name: "Ver prévia" }).click();
      await sheet.getByRole("button", { name: "Criar 3 sessões" }).click();

      await expect(page.getByRole("dialog")).toHaveCount(0);
      const rows = await seriesSessions(tag);
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map((row) => row.seriesId)).size).toBe(1);
      expect(rows.map((row) => row.startsAt)).toEqual(mondays.slice(0, 3).map((date) => brtInstant(date, "09:00")));
      expect(rows.every((row) => row.status === "scheduled" && row.patient === patients.loose.name)).toBe(true);

      // O selo e o andamento aparecem para a equipe.
      const first = session(page, patients.loose.name, ", sessão 1 de 3 da série");
      await expect(first).toBeVisible();
      await expect(first).toContainText("Série 1/3");
      await first.click();
      await expect(page.getByRole("dialog")).toContainText("Sessão 1 de 3 · 0 realizadas · 3 restantes");
    });

    test("a prévia mostra o que não cabe e só as que cabem são criadas, com o resumo das puladas", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(120_000);
      // Outro paciente já ocupa o horário da profissional na 2ª segunda.
      await seedAppointment({
        professionalName: seeded.own.name,
        patientName: patients.own.name,
        serviceName: physio(),
        startsAt: brtInstant(mondays[1]!, "09:00"),
        durationMinutes: 50,
        createdBy,
      });
      await page.goto(weekUrl());
      const sheet = await fillBooking(page, patients.loose.name);
      await sheet.getByLabel("Repetir semanalmente (série de sessões)").check();
      await sheet.getByLabel("Número de sessões").fill("3");
      await sheet.getByRole("button", { name: "Ver prévia" }).click();

      await expect(sheet.getByRole("status").filter({ hasText: "datas cabem" })).toHaveText("2 de 3 datas cabem; 1 não cabe.");
      await expect(sheet.getByRole("region", { name: "Prévia da série" }).getByRole("listitem").nth(1)).toContainText("O profissional já tem atendimento");
      await sheet.getByRole("button", { name: "Criar 2 sessões" }).click();

      // Com data pulada, a gaveta fica aberta com o resumo.
      await expect(sheet).toContainText("2 sessões criadas");
      await expect(sheet).toContainText("O profissional já tem atendimento");
      await sheet.getByRole("button", { name: "Concluir" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const rows = (await seriesSessions(tag)).filter((row) => row.patient === patients.loose.name);
      expect(rows.map((row) => row.startsAt)).toEqual([brtInstant(mondays[0]!, "09:00"), brtInstant(mondays[2]!, "09:00")]);
    });

    test("cancelar daqui para frente: cancela esta e as seguintes, com o motivo, e preserva as anteriores", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(120_000);
      await seedSeries({
        professionalName: seeded.own.name,
        patientName: patients.loose.name,
        serviceName: physio(),
        startsAts: mondays.slice(0, 3).map((date) => brtInstant(date, "09:00")),
        durationMinutes: 50,
        createdBy,
      });
      await page.goto(`/agenda?view=day&date=${mondays[1]}&professional=${ownId}`);
      await session(page, patients.loose.name, ", sessão 2 de 3 da série").click();
      let sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Cancelar atendimento" }).click();
      await sheet.getByLabel("Esta e as seguintes da série").check();
      await sheet.getByLabel("Motivo do cancelamento").fill("Paciente concluiu o pacote");
      await sheet.getByRole("button", { name: "Cancelar esta e as seguintes" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const rows = await seriesSessions(tag);
      expect(rows.map((row) => row.status)).toEqual(["scheduled", "cancelled", "cancelled"]);
      expect(rows.map((row) => row.cancelReason)).toEqual([null, "Paciente concluiu o pacote", "Paciente concluiu o pacote"]);

      // A sessão cancelada continua na série, sem posição, e o andamento conta as canceladas.
      await page.goto(`/agenda?view=day&date=${mondays[0]}&professional=${ownId}`);
      await session(page, patients.loose.name, ", sessão 1 de 1 da série").click();
      sheet = page.getByRole("dialog");
      await expect(sheet).toContainText("Sessão 1 de 1 · 0 realizadas · 1 restante · 2 canceladas");
    });

    test("remarcar daqui para frente: todas as seguintes passam para o novo horário", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(120_000);
      await seedSeries({
        professionalName: seeded.own.name,
        patientName: patients.loose.name,
        serviceName: physio(),
        startsAts: mondays.slice(0, 3).map((date) => brtInstant(date, "09:00")),
        durationMinutes: 50,
        createdBy,
      });
      await page.goto(`/agenda?view=day&date=${mondays[0]}&professional=${ownId}`);
      await session(page, patients.loose.name, ", sessão 1 de 3 da série").click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Remarcar", exact: true }).click();
      await sheet.getByLabel("Esta e as seguintes da série").check();
      await sheet.getByLabel("Novo horário de início").fill("10:00");
      await sheet.getByRole("button", { name: "Remarcar esta e as seguintes" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const rows = await seriesSessions(tag);
      expect(rows.map((row) => row.startsAt)).toEqual(mondays.slice(0, 3).map((date) => brtInstant(date, "10:00")));
      expect(rows.every((row) => row.status === "scheduled")).toBe(true);
    });

    test("renovar a série: mais sessões na mesma série, depois de ver a prévia", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(120_000);
      const { seriesId } = await seedSeries({
        professionalName: seeded.own.name,
        patientName: patients.loose.name,
        serviceName: physio(),
        startsAts: mondays.slice(0, 2).map((date) => brtInstant(date, "09:00")),
        durationMinutes: 50,
        createdBy,
      });
      // A última sessão: a sugestão de data da renovação é uma semana depois dela.
      await page.goto(`/agenda?view=day&date=${mondays[1]}&professional=${ownId}`);
      await session(page, patients.loose.name, ", sessão 2 de 2 da série").click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Renovar série" }).click();
      await expect(sheet.getByLabel("Data da primeira nova sessão")).toHaveValue(mondays[2]!);
      await sheet.getByLabel("Número de sessões").fill("2");
      await sheet.getByRole("button", { name: "Ver prévia" }).click();
      await expect(sheet.getByRole("status").filter({ hasText: "datas cabem" })).toHaveText("2 de 2 datas cabem.");
      await sheet.getByRole("button", { name: "Criar 2 sessões" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);

      const rows = await seriesSessions(tag);
      expect(rows).toHaveLength(4);
      expect(rows.every((row) => row.seriesId === seriesId)).toBe(true);
      expect(rows.map((row) => row.startsAt)).toEqual(mondays.map((date) => brtInstant(date, "09:00")));
    });
  });
}

describeSeries("admin");
describeSeries("reception");
