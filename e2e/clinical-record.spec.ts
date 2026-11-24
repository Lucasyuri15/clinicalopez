import { expect } from "@playwright/test";

import { pastStart } from "./support/agenda";
import { readUsers, testAs } from "./support/auth";
import {
  catalogTag,
  clinicalState,
  deleteCatalog,
  deletePatients,
  deleteProfessionals,
  linkPatient,
  patientIdByName,
  profileIdByEmail,
  seedAppointment,
  seedClinicalNote,
  seedPatients,
  seedProfessionals,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

/** Um início passado há `days` dias (cada atendimento do paciente em um dia diferente: sem conflito). */
const daysAgo = (days: number) => new Date(pastStart().getTime() - days * 86_400_000);

const SECRET = "Evolução secreta do colega XJ91";

/**
 * Prontuário na ficha do paciente (Fase 4A). O profissional escreve, finaliza e adenda só o que é
 * dele; o COLEGA que atende o mesmo paciente nunca é visto; a recepção não tem a seção; o admin só lê.
 *
 * Só há UM login de profissional por projeto, então "o outro profissional não lê" é provado aqui com a
 * evolução de um colega semeada pelo dono do banco (e, no banco, pela RLS com dois logins de verdade:
 * `clinical-rls*.test.ts`). O bloco do profissional é SERIAL: cada teste vincula o mesmo login a um
 * profissional e o banco só permite um profissional ativo por login.
 */
const asProfessional = testAs("professional");
asProfessional.describe("prontuário: o profissional", () => {
  asProfessional.describe.configure({ mode: "serial" });
  asProfessional.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

  let tag = "";
  let seeded: Awaited<ReturnType<typeof seedProfessionals>>;
  let patients: Awaited<ReturnType<typeof seedPatients>>;
  let loginProfileId = "";
  asProfessional.beforeEach(async ({}, testInfo) => {
    tag = catalogTag();
    const email = readUsers()[`${testInfo.project.name}-professional`]?.email ?? "";
    loginProfileId = await profileIdByEmail(email);
    seeded = await seedProfessionals(tag, { linkProfileId: loginProfileId });
    patients = await seedPatients(tag, seeded);
    await linkPatient(patients.own.name, seeded.colleague.name); // o MESMO paciente atendido pelo colega
  });
  asProfessional.afterEach(async () => {
    if (!tag) return;
    await deletePatients(tag); // evoluções, log e atendimentos usam os pacientes e os profissionais
    await deleteProfessionals(tag); // solta o login ANTES do teardown apagar o usuário
    await deleteCatalog(tag);
    tag = "";
  });

  const own = (startsAt: Date) => ({
    professionalName: seeded.own.name,
    patientName: patients.own.name,
    serviceName: seeded.physioService,
    startsAt,
    durationMinutes: 50,
    createdBy: loginProfileId,
    status: "done" as const,
  });

  asProfessional("escreve, salva rascunho, finaliza com confirmação e adenda; o banco guarda e o log registra", async ({ page }) => {
    await seedAppointment(own(daysAgo(1)));
    await page.goto(`/pacientes/${await patientIdByName(patients.own.name)}`);
    await expect(page.getByRole("heading", { name: "Prontuário" })).toBeVisible();

    // escrever e salvar como rascunho
    await page.getByRole("button", { name: /Escrever evolução de/ }).click();
    const note = page.getByRole("textbox", { name: "Evolução", exact: true });
    await note.fill("Paciente evoluiu bem, sem dor.");
    await page.getByRole("button", { name: "Salvar rascunho" }).click();
    await expect(note).toBeHidden();
    await expect(page.getByText("Paciente evoluiu bem, sem dor.")).toBeVisible();
    await expect(page.getByText("Rascunho", { exact: true })).toBeVisible();
    expect((await clinicalState(tag)).notes).toMatchObject([{ status: "draft", body: "Paciente evoluiu bem, sem dor." }]);

    // finalizar (com a confirmação que avisa que o texto fica trancado)
    await page.getByRole("button", { name: /Finalizar a evolução de/ }).click();
    await expect(page.getByText(/não dá para editar/)).toBeVisible();
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/Finalizada em/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Continuar a evolução/ })).toHaveCount(0);

    // adendar
    await page.getByRole("button", { name: /Adicionar adendo à evolução/ }).click();
    const addendum = page.getByRole("textbox", { name: "Adendo", exact: true });
    await addendum.fill("Correção: foi o lado direito.");
    await page.getByRole("button", { name: "Salvar adendo" }).click();
    await expect(addendum).toBeHidden();
    await expect(page.getByText("Correção: foi o lado direito.")).toBeVisible();

    const state = await clinicalState(tag);
    expect(state.notes).toMatchObject([{ status: "finalized", body: "Paciente evoluiu bem, sem dor.", addenda: ["Correção: foi o lado direito."] }]);
    const actions = state.log.map((row) => row.action);
    for (const action of ["read_history", "create_note", "finalize", "add_addendum"]) expect(actions).toContain(action);
    expect(state.log.every((row) => row.role === "professional")).toBe(true);
  });

  asProfessional("a evolução do colega no MESMO paciente não aparece, nem no código da página", async ({ page }) => {
    const mine = await seedAppointment(own(daysAgo(1)));
    await seedClinicalNote({ appointmentId: mine, body: "Minha evolução finalizada.", status: "finalized", authorProfileId: loginProfileId });
    const colleagueAppointment = await seedAppointment({
      professionalName: seeded.colleague.name,
      patientName: patients.own.name,
      serviceName: `${tag} Limpeza`,
      startsAt: daysAgo(3),
      durationMinutes: 40,
      createdBy: loginProfileId,
      status: "done",
    });
    await seedClinicalNote({ appointmentId: colleagueAppointment, body: SECRET, status: "finalized", authorProfileId: loginProfileId, addendum: `${SECRET} (adendo)` });

    await page.goto(`/pacientes/${await patientIdByName(patients.own.name)}`);
    await expect(page.getByText("Minha evolução finalizada.")).toBeVisible();
    await expect(page.getByText(SECRET)).toHaveCount(0);
    expect(await page.content()).not.toContain(SECRET);
    // o log só tem a leitura da PRÓPRIA evolução (1 abertura do histórico + 1 evolução)
    const reads = (await clinicalState(tag)).log;
    expect(reads.map((row) => row.action).sort()).toEqual(["read_history", "read_note"]);
  });
});

function describeStaff(role: "admin" | "reception") {
  const test = testAs(role);
  test.describe(`prontuário: ${role === "admin" ? "o admin" : "a recepção"}`, () => {
    test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

    let tag = "";
    let patientName = "";
    test.beforeEach(async ({}, testInfo) => {
      tag = catalogTag();
      const createdBy = await profileIdByEmail(readUsers()[`${testInfo.project.name}-${role}`]?.email ?? "");
      const seeded = await seedProfessionals(tag); // nenhum login de profissional: só o autor semeado pelo dono
      const patients = await seedPatients(tag, seeded);
      patientName = patients.own.name;
      const base = {
        professionalName: seeded.own.name,
        patientName,
        serviceName: seeded.physioService,
        durationMinutes: 50,
        createdBy,
        status: "done" as const,
      };
      const finalized = await seedAppointment({ ...base, startsAt: daysAgo(2) });
      await seedClinicalNote({ appointmentId: finalized, body: SECRET, status: "finalized", authorProfileId: createdBy, addendum: "Adendo semeado." });
      const draft = await seedAppointment({ ...base, startsAt: daysAgo(1) });
      await seedClinicalNote({ appointmentId: draft, body: "Rascunho semeado.", status: "draft", authorProfileId: createdBy });
    });
    test.afterEach(async () => {
      if (!tag) return;
      await deletePatients(tag);
      await deleteProfessionals(tag);
      await deleteCatalog(tag);
      tag = "";
    });

    if (role === "reception") {
      test("a ficha NÃO tem a seção Prontuário, não mostra a evolução (nem no código da página) e nada é registrado", async ({ page }) => {
        await page.goto(`/pacientes/${await patientIdByName(patientName)}`);
        await expect(page.getByRole("heading", { name: patientName })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Prontuário" })).toHaveCount(0);
        await expect(page.getByText(SECRET)).toHaveCount(0);
        const html = await page.content();
        expect(html).not.toContain(SECRET);
        expect(html).not.toContain("Rascunho semeado.");
        expect((await clinicalState(tag)).log).toEqual([]);
      });
    } else {
      test("lê todas as evoluções (inclusive o rascunho), só leitura, e a leitura fica registrada com o papel admin", async ({ page }) => {
        await page.goto(`/pacientes/${await patientIdByName(patientName)}`);
        await expect(page.getByRole("heading", { name: "Prontuário" })).toBeVisible();
        await expect(page.getByText(SECRET)).toBeVisible();
        await expect(page.getByText("Adendo semeado.")).toBeVisible();
        await expect(page.getByText("Rascunho semeado.")).toBeVisible();
        await expect(page.getByText("Rascunho", { exact: true })).toBeVisible();
        for (const name of [/Escrever evolução/, /Continuar a evolução/, /Finalizar a evolução/, /Adicionar adendo/]) {
          await expect(page.getByRole("button", { name })).toHaveCount(0);
        }
        const log = (await clinicalState(tag)).log;
        expect(log.map((row) => row.action).sort()).toEqual(["read_history", "read_note", "read_note"]);
        expect(log.every((row) => row.role === "admin")).toBe(true);
      });
    }
  });
}

describeStaff("admin");
describeStaff("reception");
