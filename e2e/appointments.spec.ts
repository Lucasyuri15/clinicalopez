import { expect, type Page } from "@playwright/test";

import { brtDate, brtInstant, esc, nextMonday, pastStart } from "./support/agenda";
import { readUsers, testAs } from "./support/auth";
import {
  appointmentsState,
  catalogTag,
  deleteCatalog,
  deletePatients,
  deleteProfessionals,
  patientIsLinked,
  professionalIdByName,
  profileIdByEmail,
  seedAppointment,
  seedPatients,
  seedProfessionals,
  seedSchedule,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

/** O botão (cartão) de um atendimento pelo trecho do rótulo ("09:00–09:50, Paciente, Serviço, Situação"). */
const appointment = (page: Page, text: string | RegExp) => page.getByRole("button", { name: text });

/**
 * Agenda (Fase 2B) para admin e recepção. O que o PROFISSIONAL vê e faz está em
 * `professional-role.spec.ts` (arquivo serial: o login do profissional só liga a um profissional por
 * vez). Cada teste cria os próprios dados etiquetados (profissionais, pacientes, serviços) e o
 * banco confirma o que foi gravado. As telas são abertas já filtradas por profissional: outros
 * testes em paralelo usam a mesma segunda-feira com profissionais de outras etiquetas.
 * Só dados FICTÍCIOS.
 */
function describeAgenda(role: "admin" | "reception") {
  const test = testAs(role);
  test.describe(`perfil ${role}: agenda`, () => {
    test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

    let tag = "";
    let seeded: Awaited<ReturnType<typeof seedProfessionals>>;
    let patients: Awaited<ReturnType<typeof seedPatients>>;
    let monday = "";
    let createdBy = "";
    let ownId = "";
    test.beforeEach(async ({}, testInfo) => {
      tag = catalogTag();
      seeded = await seedProfessionals(tag);
      await seedSchedule(seeded);
      patients = await seedPatients(tag, seeded);
      monday = nextMonday();
      createdBy = await profileIdByEmail(readUsers()[`${testInfo.project.name}-${role}`]?.email ?? "");
      ownId = await professionalIdByName(seeded.own.name);
    });
    test.afterEach(async () => {
      if (!tag) return;
      // Ordem: pacientes (e seus atendimentos), profissionais, catálogo.
      await deletePatients(tag);
      await deleteProfessionals(tag);
      await deleteCatalog(tag);
      tag = "";
    });

    const dayUrl = (date = monday) => `/agenda?view=day&date=${date}&professional=${ownId}`;
    const physio = () => seeded.physioService;

    test("a lista e a gaveta de detalhe abrem (desktop e celular)", async ({ page }) => {
      await seedAppointment({
        professionalName: seeded.own.name,
        patientName: patients.own.name,
        serviceName: physio(),
        startsAt: brtInstant(monday, "09:00"),
        durationMinutes: 50,
        createdBy,
      });
      await page.goto(dayUrl());
      await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
      const card = appointment(page, `09:00–09:50, ${patients.own.name}, ${physio()}, Agendada`);
      await expect(card).toBeVisible();
      await card.click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toContainText(patients.own.name);
      await expect(sheet).toContainText(physio());
      await expect(sheet.getByRole("button", { name: "Remarcar" })).toBeVisible();
      await expect(sheet.getByRole("button", { name: "Cancelar atendimento" })).toBeVisible();
      // valor do serviço nunca aparece na agenda
      await expect(sheet).not.toContainText("R$");
    });

    test("agenda pelo formulário: cria o atendimento, copia o valor e vincula o paciente", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(90_000);
      await page.goto(dayUrl());
      await page.getByRole("button", { name: "Agendar", exact: true }).click();
      const sheet = page.getByRole("dialog");

      await sheet.getByLabel("Paciente", { exact: true }).fill(patients.loose.name);
      await sheet.getByRole("button", { name: new RegExp(esc(patients.loose.name)) }).click();
      await expect(sheet.getByTestId("selected-patient")).toHaveText(patients.loose.name);
      // o profissional já vem da visão filtrada e a grade dele aparece como dica
      await expect(sheet.getByLabel("Profissional", { exact: true })).toHaveValue(ownId);
      await expect(sheet.getByTestId("grid-hint")).toContainText("Segunda-feira: 08:00–12:00 · 14:00–18:00");
      await sheet.getByLabel("Serviço", { exact: true }).selectOption({ label: `${physio()} (50 min)` });
      await expect(sheet.getByLabel("Duração (minutos)")).toHaveValue("50");
      await sheet.getByLabel("Horário de início").fill("09:00");
      await sheet.getByRole("button", { name: "Agendar", exact: true }).click();

      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(appointment(page, `09:00–09:50, ${patients.loose.name}, ${physio()}, Agendada`)).toBeVisible();

      const rows = await appointmentsState(tag);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        patient: patients.loose.name,
        professional: seeded.own.name,
        status: "scheduled",
        priceCents: 8765431, // valor particular do serviço, copiado na criação
      });
      expect(rows[0]?.startsAt).toEqual(brtInstant(monday, "09:00"));
      expect(rows[0]?.endsAt).toEqual(brtInstant(monday, "09:50"));
      expect(await patientIsLinked(patients.loose.name, seeded.own.name)).toBe(true);
    });

    test("recusa conflito do profissional, fora da grade e conflito do paciente, sem gravar nada", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(120_000);
      await seedAppointment({
        professionalName: seeded.own.name,
        patientName: patients.own.name,
        serviceName: physio(),
        startsAt: brtInstant(monday, "09:00"),
        durationMinutes: 50,
        createdBy,
      });
      // o paciente `loose` já está ocupado às 14:00 com o colega (o dono do banco ignora a grade)
      await seedAppointment({
        professionalName: seeded.colleague.name,
        patientName: patients.loose.name,
        serviceName: `${tag} Limpeza`,
        startsAt: brtInstant(monday, "14:00"),
        durationMinutes: 40,
        createdBy,
      });

      await page.goto(dayUrl());
      await page.getByRole("button", { name: "Agendar", exact: true }).click();
      const sheet = page.getByRole("dialog");
      const error = sheet.getByTestId("form-error");
      const submit = sheet.getByRole("button", { name: "Agendar", exact: true });

      await sheet.getByLabel("Paciente", { exact: true }).fill(patients.ownForeign.name);
      // Enter na busca NÃO envia o agendamento (sem paciente): só a busca continua
      await sheet.getByLabel("Paciente", { exact: true }).press("Enter");
      await sheet.getByRole("button", { name: new RegExp(esc(patients.ownForeign.name)) }).click();
      await expect(error).toHaveCount(0);
      await sheet.getByLabel("Serviço", { exact: true }).selectOption({ label: `${physio()} (50 min)` });
      // a duração ajustada à mão (90 min) tem que sobreviver aos erros do servidor
      await sheet.getByLabel("Duração (minutos)").fill("90");

      // 1) o profissional já atende às 09:00–09:50
      await sheet.getByLabel("Horário de início").fill("09:30");
      await submit.click();
      await expect(error).toContainText("O profissional já tem um atendimento nesse horário.");
      await expect(sheet.getByLabel("Duração (minutos)")).toHaveValue("90");

      // 2) 13:00 é o intervalo do almoço, fora da grade
      await sheet.getByLabel("Horário de início").fill("13:00");
      await submit.click();
      await expect(error).toContainText("Esse horário está fora do atendimento do profissional.");

      // 3) o paciente `loose` já tem atendimento às 14:00 (com o colega)
      await sheet.getByRole("button", { name: "Trocar" }).click();
      await sheet.getByLabel("Paciente", { exact: true }).fill(patients.loose.name);
      await sheet.getByRole("button", { name: new RegExp(esc(patients.loose.name)) }).click();
      await sheet.getByLabel("Horário de início").fill("14:00");
      await submit.click();
      await expect(error).toContainText("O paciente já tem um atendimento nesse horário.");

      // nada novo foi gravado: continuam só os dois atendimentos montados
      expect(await appointmentsState(tag)).toHaveLength(2);
    });

    test("remarca e cancela exigindo o motivo; o banco confirma", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(90_000);
      await seedAppointment({
        professionalName: seeded.own.name,
        patientName: patients.own.name,
        serviceName: physio(),
        startsAt: brtInstant(monday, "10:00"),
        durationMinutes: 50,
        createdBy,
        status: "confirmed",
      });
      await page.goto(dayUrl());

      // remarcar 10:00 → 11:00 (a confirmada volta a Agendada)
      await appointment(page, /10:00–10:50/).click();
      let sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Remarcar" }).click();
      await sheet.getByLabel("Novo horário de início").fill("11:00");
      await sheet.getByRole("button", { name: "Remarcar", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(appointment(page, /11:00–11:50, .*Agendada/)).toBeVisible();
      let rows = await appointmentsState(tag);
      expect(rows[0]?.startsAt).toEqual(brtInstant(monday, "11:00"));
      expect(rows[0]?.status).toBe("scheduled");

      // cancelar sem motivo: recusa com mensagem; depois com motivo
      await appointment(page, /11:00–11:50/).click();
      sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Cancelar atendimento" }).click();
      await sheet.getByRole("button", { name: "Confirmar cancelamento" }).click();
      await expect(sheet.getByTestId("form-error")).toContainText("Informe o motivo do cancelamento.");
      expect((await appointmentsState(tag))[0]?.status).toBe("scheduled");

      await sheet.getByLabel("Motivo do cancelamento").fill("Paciente desmarcou por telefone");
      await sheet.getByRole("button", { name: "Confirmar cancelamento" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(appointment(page, /11:00–11:50, .*Cancelada/)).toBeVisible();
      rows = await appointmentsState(tag);
      expect(rows[0]).toMatchObject({ status: "cancelled", cancelReason: "Paciente desmarcou por telefone" });

      // cancelada é terminal: o motivo aparece para a equipe e não há mais ação
      await appointment(page, /11:00–11:50/).click();
      sheet = page.getByRole("dialog");
      await expect(sheet).toContainText("Paciente desmarcou por telefone");
      await expect(sheet.getByRole("button", { name: "Remarcar" })).toHaveCount(0);
      await expect(sheet.getByRole("button", { name: "Cancelar atendimento" })).toHaveCount(0);
    });

    test("confirma, marca realizada e (só o admin) corrige para falta", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(90_000);
      await seedAppointment({
        professionalName: seeded.own.name,
        patientName: patients.own.name,
        serviceName: physio(),
        startsAt: brtInstant(monday, "08:00"),
        durationMinutes: 50,
        createdBy,
      });
      const past = pastStart();
      await seedAppointment({
        professionalName: seeded.own.name,
        patientName: patients.ownForeign.name,
        serviceName: physio(),
        startsAt: past,
        durationMinutes: 30,
        createdBy,
      });

      // futuro: Confirmar sim; Realizada e Falta ainda não
      await page.goto(dayUrl());
      await appointment(page, /08:00–08:50/).click();
      let sheet = page.getByRole("dialog");
      await expect(sheet.getByRole("button", { name: "Marcar como realizada" })).toHaveCount(0);
      await sheet.getByRole("button", { name: "Confirmar atendimento" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(appointment(page, /08:00–08:50, .*Confirmada/)).toBeVisible();
      expect((await appointmentsState(tag)).find((row) => row.patient === patients.own.name)?.status).toBe("confirmed");

      // passado: Realizada
      await page.goto(dayUrl(brtDate(past)));
      await appointment(page, new RegExp(esc(patients.ownForeign.name))).click();
      sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Marcar como realizada" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const done = (await appointmentsState(tag)).find((row) => row.patient === patients.ownForeign.name);
      expect(done).toMatchObject({ status: "done", statusChanged: true });

      // corrigir Realizada → Falta: só o admin
      await appointment(page, new RegExp(`${esc(patients.ownForeign.name)}.*Realizada`)).click();
      sheet = page.getByRole("dialog");
      if (role === "admin") {
        await sheet.getByRole("button", { name: "Corrigir para falta" }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        expect((await appointmentsState(tag)).find((row) => row.patient === patients.ownForeign.name)?.status).toBe(
          "no_show",
        );
      } else {
        await expect(sheet.getByRole("button", { name: /Corrigir/ })).toHaveCount(0);
      }
    });

    test("visão de semana, navegação por links e filtros na URL", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      await seedAppointment({
        professionalName: seeded.own.name,
        patientName: patients.own.name,
        serviceName: physio(),
        startsAt: brtInstant(monday, "09:00"),
        durationMinutes: 50,
        createdBy,
      });
      await page.goto(`/agenda?view=week&date=${monday}&professional=${ownId}`);
      await expect(page.getByRole("heading", { level: 3, name: /Segunda-feira/ })).toBeVisible();
      await expect(page.getByRole("heading", { level: 3, name: /Domingo/ })).toBeVisible();
      await expect(appointment(page, new RegExp(`09:00–09:50, ${esc(patients.own.name)}`))).toBeVisible();

      await page.getByRole("link", { name: "Próxima semana" }).click();
      await expect(page).toHaveURL(/view=week/);
      await expect(page).not.toHaveURL(new RegExp(`date=${monday}`)); // andou uma semana
      await expect(appointment(page, new RegExp(esc(patients.own.name)))).toHaveCount(0);
      await page.getByRole("link", { name: "Semana anterior" }).click();
      await expect(page).toHaveURL(new RegExp(`date=${monday}`));
      await expect(appointment(page, new RegExp(esc(patients.own.name)))).toBeVisible();

      await page.getByRole("navigation", { name: "Visão" }).getByRole("link", { name: "Dia" }).click();
      await expect(page).toHaveURL(/view=day/);
      await expect(page).toHaveURL(new RegExp(`professional=${ownId}`));
      // nenhum dado de paciente na URL
      expect(page.url()).not.toContain(encodeURIComponent(patients.own.name));
    });
  });
}

describeAgenda("admin");
describeAgenda("reception");
