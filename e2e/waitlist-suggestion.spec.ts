import { expect, type Page } from "@playwright/test";

import { brtInstant, esc, nextMonday } from "./support/agenda";
import { readUsers, testAs } from "./support/auth";
import {
  appointmentsState,
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
  seedWaitlistEntry,
  waitlistState,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

/**
 * Sugestão da lista de espera ao cancelar (Fase 3B-2) para admin e recepção: o horário que vagou
 * mostra quem cabe, Agendar vira um atendimento comum e a espera fica atendida; sem candidato, a
 * gaveta fecha como sempre. O banco confirma cada gravação. O profissional não cancela nem vê a
 * espera (menu e rota em `rbac.spec.ts`). Cada teste cria os próprios dados etiquetados. Fluxos
 * longos: só no desktop. Só dados FICTÍCIOS.
 */
const appointment = (page: Page, text: string | RegExp) => page.getByRole("button", { name: text });

function describeSuggestion(role: "admin" | "reception") {
  const test = testAs(role);
  test.describe(`perfil ${role}: sugestão da lista de espera ao cancelar`, () => {
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
      // O atendimento das 09:00 que cada teste vai cancelar.
      await seedAppointment({
        professionalName: seeded.own.name,
        patientName: patients.own.name,
        serviceName: seeded.physioService,
        startsAt: brtInstant(monday, "09:00"),
        durationMinutes: 50,
        createdBy,
      });
    });
    test.afterEach(async () => {
      if (!tag) return;
      // Ordem: pacientes (com atendimentos e esperas), profissionais, catálogo.
      await deletePatients(tag);
      await deleteProfessionals(tag);
      await deleteCatalog(tag);
      tag = "";
    });

    const dayUrl = () => `/agenda?view=day&date=${monday}&professional=${ownId}`;

    /** Abre o atendimento das 09:00 e confirma o cancelamento com um motivo. */
    async function cancelNineOClock(page: Page) {
      await page.goto(dayUrl());
      await appointment(page, /09:00–09:50/).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Cancelar atendimento" }).click();
      await sheet.getByLabel("Motivo do cancelamento").fill("Paciente desmarcou por telefone");
      await sheet.getByRole("button", { name: "Confirmar cancelamento" }).click();
      return sheet;
    }

    // Roda também no celular: é o fluxo principal e a gaveta ocupa quase a tela toda.
    test("cancela, vê quem cabe e agenda com um clique; a espera fica atendida", async ({ page }) => {
      test.setTimeout(120_000);
      // Cabe: qualquer profissional, qualquer dia. Não cabe: só às terças.
      await seedWaitlistEntry({ patientName: patients.loose.name, serviceName: seeded.physioService, createdBy });
      await seedWaitlistEntry({ patientName: patients.ownForeign.name, serviceName: seeded.physioService, weekdays: [2], createdBy });

      const sheet = await cancelNineOClock(page);
      await expect(sheet).toContainText("ficou livre");
      await expect(sheet).toContainText("1 pessoa da lista de espera cabe");
      const candidates = sheet.getByRole("listitem");
      await expect(candidates).toHaveCount(1);
      await expect(candidates.first()).toContainText(patients.loose.name);
      await expect(candidates.first()).toContainText("09:00–09:50");
      await expect(sheet).not.toContainText(patients.ownForeign.name);
      // O cancelamento já valeu, mesmo com a gaveta aberta.
      expect((await appointmentsState(tag))[0]).toMatchObject({ status: "cancelled" });

      await sheet.getByRole("button", { name: `Agendar ${patients.loose.name}` }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(appointment(page, `09:00–09:50, ${patients.loose.name}, ${seeded.physioService}, Agendada`)).toBeVisible();

      const rows = await appointmentsState(tag);
      expect(rows).toHaveLength(2);
      const booked = rows.find((row) => row.patient === patients.loose.name);
      expect(booked).toMatchObject({ professional: seeded.own.name, status: "scheduled", priceCents: 8765431 });
      expect(booked?.startsAt).toEqual(brtInstant(monday, "09:00"));
      expect(booked?.endsAt).toEqual(brtInstant(monday, "09:50"));

      const waiting = await waitlistState(tag);
      expect(waiting.find((row) => row.patient === patients.loose.name)).toMatchObject({ status: "fulfilled", hasClosedStamp: true });
      expect(waiting.find((row) => row.patient === patients.ownForeign.name)).toMatchObject({ status: "waiting" });
    });

    test("Concluir deixa tudo como está: ninguém é agendado e a espera continua", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(90_000);
      await seedWaitlistEntry({ patientName: patients.loose.name, serviceName: seeded.physioService, professionalName: seeded.own.name, createdBy });

      const sheet = await cancelNineOClock(page);
      await expect(sheet.getByRole("listitem").first()).toContainText(patients.loose.name);
      await sheet.getByRole("button", { name: "Concluir" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(appointment(page, new RegExp(`09:00–09:50, ${esc(patients.own.name)}.*Cancelada`))).toBeVisible();

      expect(await appointmentsState(tag)).toHaveLength(1);
      expect((await waitlistState(tag))[0]).toMatchObject({ status: "waiting" });
    });

    test("sem ninguém que caiba, a gaveta fecha como sempre", async ({ page, isMobile }) => {
      test.skip(isMobile, "fluxo longo: só no desktop");
      test.setTimeout(90_000);
      // Só às terças: o horário liberado é uma segunda.
      await seedWaitlistEntry({ patientName: patients.loose.name, serviceName: seeded.physioService, weekdays: [2], createdBy });

      await cancelNineOClock(page);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByText("ficou livre")).toHaveCount(0);
      expect((await appointmentsState(tag))[0]).toMatchObject({ status: "cancelled" });
      expect((await waitlistState(tag))[0]).toMatchObject({ status: "waiting" });
    });
  });
}

describeSuggestion("admin");
describeSuggestion("reception");
