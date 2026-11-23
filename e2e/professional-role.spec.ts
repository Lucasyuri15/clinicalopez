import { expect, type Page } from "@playwright/test";

import { brtDate, brtInstant, esc, freeMondays, nextMonday, pastStart } from "./support/agenda";
import { readUsers, testAs } from "./support/auth";
import {
  appointmentsState,
  catalogTag,
  deleteCatalog,
  deletePatients,
  deleteProfessionals,
  patientIdByName,
  professionalIdByName,
  profileIdByEmail,
  seedAppointment,
  seedConsent,
  seedPatients,
  seedProfessionals,
  seedSchedule,
  seedSeries,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

/** Cartão (`<li>`) de um profissional pelo nome. */
const card = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

/**
 * Tudo o que o perfil PROFISSIONAL enxerga do cadastro e da grade: só o que é dele, nunca o de
 * colegas (nem escondido no HTML).
 *
 * Fica num arquivo só, em modo SERIAL, de propósito: estes testes vinculam o MESMO login fictício
 * (`<projeto>-professional`) a um profissional, e o banco só permite um profissional ativo por
 * login. Com `fullyParallel`, dois testes assim em arquivos diferentes podiam rodar ao mesmo tempo
 * e esbarrar nesse índice único. (Desktop e celular usam logins diferentes, então não colidem.)
 */
const asProfessional = testAs("professional");
asProfessional.describe("perfil profissional: só o próprio cadastro e a própria grade", () => {
  asProfessional.describe.configure({ mode: "serial" });
  asProfessional.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

  let tag = "";
  let seeded: Awaited<ReturnType<typeof seedProfessionals>>;
  let schedule: Awaited<ReturnType<typeof seedSchedule>>;
  let patients: Awaited<ReturnType<typeof seedPatients>>;
  asProfessional.beforeEach(async ({}, testInfo) => {
    tag = catalogTag();
    const email = readUsers()[`${testInfo.project.name}-professional`]?.email ?? "";
    seeded = await seedProfessionals(tag, { linkProfileId: await profileIdByEmail(email) });
    schedule = await seedSchedule(seeded);
    patients = await seedPatients(tag, seeded);
  });
  asProfessional.afterEach(async () => {
    if (!tag) return;
    await deletePatients(tag); // os vínculos usam os profissionais
    await deleteProfessionals(tag); // solta o login ANTES do teardown apagar o usuário
    await deleteCatalog(tag);
    tag = "";
  });

  asProfessional("vê 'Meu cadastro' com os próprios dados e nenhum dado de colegas, nem no código da página", async ({ page }) => {
    await page.goto("/profissionais");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meu cadastro");
    const own = card(page, seeded.own.name);
    await expect(own).toContainText(seeded.own.phoneShown);
    await expect(own).toContainText(seeded.own.email);
    await expect(own).toContainText(seeded.physioService);
    await expect(own.getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Novo profissional" })).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: "Ana Propria" })).toHaveCount(1);

    // nada do colega: nem na tela nem no HTML entregue (inclui os dados embutidos para hidratar a página)
    await expect(page.getByText("Bruno Colega")).toHaveCount(0);
    const html = await page.content();
    for (const secret of [
      "Bruno Colega",
      seeded.colleague.email,
      seeded.colleague.phoneDigits,
      "93333-4444",
      seeded.colleague.registration,
      `${tag} Limpeza`,
    ]) {
      expect(html, secret).not.toContain(secret);
    }
  });

  asProfessional("vê 'Meus horários', e a grade de um colega vira 'não encontrado' sem vazar nada", async ({ page }) => {
    await page.goto("/profissionais");
    await card(page, seeded.own.name).getByRole("link", { name: `Ver horários de ${seeded.own.name}` }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meus horários");
    await expect(page.getByText("08:00–12:00 · 14:00–18:00")).toBeVisible();
    await expect(page.getByText(schedule.ownOffReason)).toBeVisible();
    await expect(page.getByRole("button", { name: /Salvar horários|Adicionar|Remover/ })).toHaveCount(0);
    await expect(page.getByText(schedule.colleagueOffReason)).toHaveCount(0);

    // a grade do colega: a RLS não devolve o cadastro, então a página não existe para ele
    const colleagueId = await professionalIdByName(seeded.colleague.name);
    await page.goto(`/profissionais/${colleagueId}/horarios`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Não encontrado");
    const html = await page.content();
    for (const secret of [schedule.colleagueOffReason, "Bruno Colega", "09:00–13:00"]) {
      expect(html, secret).not.toContain(secret);
    }
  });

  asProfessional("vê só os pacientes vinculados a ele, e nunca CPF, endereço nem observações (nem dos dele)", async ({ page }) => {
    await page.goto("/pacientes");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meus pacientes");
    await expect(card(page, patients.own.name)).toHaveCount(1);
    await expect(card(page, patients.ownForeign.name)).toHaveCount(1); // o segundo paciente dele (sem CPF)
    await expect(page.getByText("Paciente Alheio")).toHaveCount(0);
    await expect(page.getByText("Paciente Solto")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Novo paciente|Desativar|Ativar/ })).toHaveCount(0);

    // nada reservado, nem na tela nem no HTML entregue (inclui os dados embutidos para hidratar a página)
    const html = await page.content();
    for (const secret of [
      patients.other.name,
      patients.loose.name,
      ...patients.own.secrets, // TODO o reservado do paciente dele: CPF, endereço, convênio, responsável, observações
      patients.ownForeign.reason,
      patients.other.cpfDigits,
      patients.other.street,
    ]) {
      expect(html, secret).not.toContain(secret);
    }

    // a busca por CPF não serve de pergunta ("este CPF existe?"): nem o CPF do paciente dele casa
    const none = page.getByText("Nenhum paciente encontrado para essa busca.");
    await page.getByLabel("Buscar paciente").fill(patients.own.cpfShown);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(none).toBeVisible();
    // pelo nome acha (e some o aviso: prova que a resposta chegou); o CPF do responsável também não casa
    await page.getByLabel("Buscar paciente").fill("Paciente Proprio");
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(none).toBeHidden();
    await expect(card(page, patients.own.name)).toHaveCount(1);
    expect(page.url()).not.toContain("q=");
  });

  asProfessional("abre o paciente dele (só o básico) e o de outro vira 'não encontrado' sem vazar nada", async ({ page }) => {
    await page.goto("/pacientes");
    await card(page, patients.own.name).getByRole("link", { name: `Abrir cadastro de ${patients.own.name}` }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(patients.own.name);
    await expect(page.getByText(patients.own.phoneShown)).toBeVisible();
    await expect(page.getByRole("button", { name: /Editar|Remover|Desativar|Confirmar/ })).toHaveCount(0);
    await expect(page.getByText("Documento e convênio")).toHaveCount(0);
    await expect(page.getByText("Observações administrativas")).toHaveCount(0);
    const own = await page.content();
    for (const secret of [...patients.own.secrets, patients.ownForeign.reason]) {
      expect(own, secret).not.toContain(secret);
    }

    // paciente de outro profissional e paciente sem vínculo: a RLS não devolve a linha
    for (const other of [patients.other.name, patients.loose.name]) {
      const id = await patientIdByName(other);
      await page.goto(`/pacientes/${id}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Não encontrado");
      const html = await page.content();
      for (const secret of [other, patients.other.cpfDigits, patients.other.street, patients.other.notes]) {
        expect(html, secret).not.toContain(secret);
      }
    }
  });

  asProfessional("não vê consentimento LGPD, nem o aviso, nem no código da página; não abre os removidos", async ({ page }, testInfo) => {
    const adminEmail = readUsers()[`${testInfo.project.name}-admin`]?.email ?? "";
    expect(adminEmail, "o admin fictício do projeto precisa existir para registrar o consentimento").not.toBe("");
    const secretNote = "Nota reservada do consentimento";
    // O paciente dele TEM consentimento registrado (por um admin): o profissional não pode ver nem isso.
    await seedConsent({ patientName: patients.own.name, registeredByEmail: adminEmail, note: secretNote });
    const id = await patientIdByName(patients.own.name);

    await page.goto(`/pacientes/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(patients.own.name);
    await expect(page.getByText("Consentimentos (LGPD)")).toHaveCount(0);
    await expect(page.getByText("Sem consentimento LGPD")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Registrar consentimento/ })).toHaveCount(0);
    const html = await page.content();
    for (const secret of [secretNote, "Consentimentos (LGPD)", "Papel assinado"]) {
      expect(html, secret).not.toContain(secret);
    }

    // a lista dele também não traz o aviso (nem o de quem teria consentimento a registrar)
    await page.goto("/pacientes");
    await expect(card(page, patients.own.name)).toHaveCount(1);
    await expect(page.getByText("Sem consentimento LGPD")).toHaveCount(0);

    // reativar removidos é só do admin: o profissional volta ao Dashboard
    await page.goto("/pacientes/removidos");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText("Pacientes removidos")).toHaveCount(0);
  });

  /** O perfil do admin fictício do projeto: autor dos atendimentos montados pelo dono do banco. */
  async function adminProfileId(projectName: string): Promise<string> {
    return profileIdByEmail(readUsers()[`${projectName}-admin`]?.email ?? "");
  }

  asProfessional("agenda: vê só os atendimentos dele, sem Agendar, sem filtro, sem valor e sem motivo de cancelamento", async ({ page }, testInfo) => {
    const createdBy = await adminProfileId(testInfo.project.name);
    const monday = nextMonday();
    const secretReason = "Motivo reservado do cancelamento";
    await seedAppointment({
      professionalName: seeded.own.name,
      patientName: patients.own.name,
      serviceName: seeded.physioService,
      startsAt: brtInstant(monday, "10:00"),
      durationMinutes: 50,
      createdBy,
      priceCents: 1234567,
    });
    await seedAppointment({
      professionalName: seeded.own.name,
      patientName: patients.ownForeign.name,
      serviceName: seeded.physioService,
      startsAt: brtInstant(monday, "14:00"),
      durationMinutes: 50,
      createdBy,
      status: "cancelled",
      cancelReason: secretReason,
    });
    // atendimento do colega com outro paciente: nada dele pode aparecer
    await seedAppointment({
      professionalName: seeded.colleague.name,
      patientName: patients.other.name,
      serviceName: `${tag} Limpeza`,
      startsAt: brtInstant(monday, "10:00"),
      durationMinutes: 40,
      createdBy,
    });

    await page.goto(`/agenda?view=day&date=${monday}`);
    await expect(page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Agendar", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Profissional", { exact: true })).toHaveCount(0);
    const mine = page.getByRole("button", { name: new RegExp(`10:00–10:50, ${esc(patients.own.name)}`) });
    await expect(mine).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(esc(patients.ownForeign.name)) })).toBeVisible();
    await expect(page.getByText("Bruno Colega")).toHaveCount(0);

    // nada do colega, nenhum valor e nenhum motivo de cancelamento: nem na tela nem no HTML entregue
    const html = await page.content();
    for (const secret of [patients.other.name, "Bruno Colega", `${tag} Limpeza`, secretReason, "12.345,67", "1234567", "12345,67"]) {
      expect(html, secret).not.toContain(secret);
    }

    // o atendimento futuro: sem remarcar, cancelar nem confirmar; Realizada e Falta só depois do início
    await mine.click();
    let sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("ficam disponíveis a partir do início");
    await expect(sheet.getByRole("button", { name: /Remarcar|Cancelar atendimento|Confirmar atendimento|Marcar como realizada|Registrar falta/ })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Fechar" }).click();

    // o cancelado: o profissional não recebe o motivo
    await page.getByRole("button", { name: new RegExp(esc(patients.ownForeign.name)) }).click();
    sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Cancelada");
    await expect(sheet).not.toContainText(secretReason);
    expect(await page.content(), secretReason).not.toContain(secretReason);
  });

  asProfessional("agenda: as sessões de uma série aparecem como atendimentos comuns, sem selo, andamento, escopo nem renovar (nem no HTML)", async ({ page }, testInfo) => {
    const createdBy = await adminProfileId(testInfo.project.name);
    const [first, second] = freeMondays(2) as [string, string];
    const { seriesId } = await seedSeries({
      professionalName: seeded.own.name,
      patientName: patients.own.name,
      serviceName: seeded.physioService,
      startsAts: [brtInstant(first, "09:00"), brtInstant(second, "09:00")],
      durationMinutes: 50,
      createdBy,
    });

    await page.goto(`/agenda?view=day&date=${first}`);
    const mine = page.getByRole("button", { name: new RegExp(`09:00–09:50, ${esc(patients.own.name)}`) });
    await expect(mine).toBeVisible();
    // O nome acessível e o texto do cartão não falam de série.
    await expect(mine).not.toContainText("Série");
    expect(await mine.getAttribute("aria-label")).not.toMatch(/série|sessão \d/i);

    await mine.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText(patients.own.name);
    for (const text of ["Série", "Sessão 1 de 2", "Renovar série", "Esta e as seguintes", "restantes"]) {
      await expect(sheet, text).not.toContainText(text);
    }
    // Nem o id da série, nem o selo, nem o botão de renovar vão no HTML entregue ao profissional.
    const html = await page.content();
    for (const secret of [seriesId, "Série 1/2", "Renovar série", "Esta e as seguintes da série"]) {
      expect(html, secret).not.toContain(secret);
    }
  });

  asProfessional("agenda: marca Realizada e Falta nos próprios atendimentos (e não corrige depois)", async ({ page }, testInfo) => {
    const createdBy = await adminProfileId(testInfo.project.name);
    const past = pastStart();
    await seedAppointment({
      professionalName: seeded.own.name,
      patientName: patients.own.name,
      serviceName: seeded.physioService,
      startsAt: past,
      durationMinutes: 30,
      createdBy,
    });

    await page.goto(`/agenda?view=day&date=${brtDate(past)}`);
    await page.getByRole("button", { name: new RegExp(esc(patients.own.name)) }).click();
    let sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: /Remarcar|Cancelar atendimento|Confirmar atendimento/ })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: "Marcar como realizada" })).toBeVisible();
    await sheet.getByRole("button", { name: "Registrar falta" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await appointmentsState(tag)).toMatchObject([{ patient: patients.own.name, status: "no_show", statusChanged: true }]);

    // depois de registrada, só o admin corrige: o profissional não tem mais ação
    await page.getByRole("button", { name: new RegExp(`${esc(patients.own.name)}.*Falta`) }).click();
    sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: /Corrigir|Marcar como realizada|Registrar falta/ })).toHaveCount(0);
  });
});
