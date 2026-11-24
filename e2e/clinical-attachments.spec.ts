import { expect } from "@playwright/test";

import { pastStart } from "./support/agenda";
import { readUsers, testAs } from "./support/auth";
import { acquireLoginLock } from "./support/login-lock";
import {
  attachmentsState,
  catalogTag,
  deleteCatalog,
  deletePatients,
  deleteProfessionals,
  linkPatient,
  patientIdByName,
  profileIdByEmail,
  seedAppointment,
  seedClinicalAttachment,
  seedPatients,
  seedProfessionals,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

const daysAgo = (days: number) => new Date(pastStart().getTime() - days * 86_400_000);

const SECRET_NAME = "Exame secreto do colega XJ91.pdf";
/** Um PDF mínimo (só o cabeçalho conta para o servidor) e um PNG 1x1 válido. */
const pdf = (seed: string) => Buffer.from(`%PDF-1.7\n% ${seed}\n${"x".repeat(64)}`);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Anexos clínicos na ficha do paciente (Fase 4B-1), com o STORAGE REAL do Supabase dev. O profissional
 * anexa, abre e remove só o que é dele; o arquivo disfarçado é recusado; o colega no MESMO paciente
 * nunca é visto; a recepção não tem o cartão; o admin só lê.
 *
 * Só há UM login de profissional por projeto: "o outro profissional não lê" é provado aqui com o anexo
 * de um colega semeado pelo dono (e, no banco, pela RLS com dois logins: `clinical-attachments-*.test.ts`).
 * LIMITE: o arquivo no Storage só some pela API do Storage (o e2e não tem chave secret), então cada
 * execução deixa 1 ou 2 arquivinhos fictícios no bucket de DEV, sem linha (ilegíveis); apagar os
 * metadados não os remove. Esvaziar o bucket no painel do Supabase DEV quando quiser.
 */
const asProfessional = testAs("professional");
asProfessional.describe("anexos: o profissional", () => {
  asProfessional.describe.configure({ mode: "serial" });
  asProfessional.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

  // O mesmo login de profissional é ligado a um profissional de teste por este spec e por outros: um de
  // cada vez (ver `support/login-lock.ts`). Fica no beforeAll para a espera não contar no tempo do teste.
  let releaseLogin: (() => void) | undefined;
  asProfessional.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(10 * 60_000);
    releaseLogin = await acquireLoginLock(`${testInfo.project.name}-professional`);
  });
  asProfessional.afterAll(() => {
    releaseLogin?.();
  });

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
    await linkPatient(patients.own.name, seeded.colleague.name);
  });
  asProfessional.afterEach(async () => {
    if (!tag) return;
    await deletePatients(tag);
    await deleteProfessionals(tag);
    await deleteCatalog(tag);
    tag = "";
  });

  asProfessional("anexa PDF e imagem (um ligado a um atendimento), abre os dois, remove um com confirmação; banco e log batem", async ({ page }) => {
    const appointmentId = await seedAppointment({
      professionalName: seeded.own.name,
      patientName: patients.own.name,
      serviceName: seeded.physioService,
      startsAt: daysAgo(1),
      durationMinutes: 50,
      createdBy: loginProfileId,
      status: "done",
    });
    const patientId = await patientIdByName(patients.own.name);
    await page.goto(`/pacientes/${patientId}`);
    await expect(page.getByRole("heading", { name: "Anexos" })).toBeVisible();
    await expect(page.getByText("Nenhum anexo.")).toBeVisible();

    // anexar um PDF ligado ao atendimento Realizado
    await page.getByRole("button", { name: "Anexar arquivo" }).click();
    await page.getByLabel("Arquivo", { exact: true }).setInputFiles({ name: "Ressonância joelho.pdf", mimeType: "application/pdf", buffer: pdf("um") });
    await page.getByLabel("Atendimento (opcional)").selectOption(appointmentId);
    await page.getByRole("button", { name: "Anexar", exact: true }).click();
    await expect(page.getByLabel("Arquivo", { exact: true })).toBeHidden();
    await expect(page.getByText("Ressonância joelho.pdf")).toBeVisible();

    // anexar uma imagem sem atendimento
    await page.getByRole("button", { name: "Anexar arquivo" }).click();
    await page.getByLabel("Arquivo", { exact: true }).setInputFiles({ name: "foto lesão.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Anexar", exact: true }).click();
    await expect(page.getByText("foto lesão.png")).toBeVisible();

    let state = await attachmentsState(tag);
    expect(state.attachments).toMatchObject([
      { name: "Ressonância joelho.pdf", contentType: "application/pdf", appointmentId, removed: false },
      { name: "foto lesão.png", contentType: "image/png", appointmentId: null, removed: false },
    ]);

    // abrir: os bytes voltam do Storage REAL pelo nosso servidor, com os cabeçalhos seguros
    const pdfLink = page.getByRole("link", { name: "Baixar Ressonância joelho.pdf" });
    const pdfHref = (await pdfLink.getAttribute("href"))!;
    const pdfResponse = await page.request.get(pdfHref);
    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()["content-type"]).toBe("application/pdf");
    expect(pdfResponse.headers()["x-content-type-options"]).toBe("nosniff");
    expect(pdfResponse.headers()["cache-control"]).toContain("no-store"); // sobrevive ao que o proxy acrescenta
    expect(pdfResponse.headers()["content-disposition"]).toMatch(/^attachment;/);
    expect((await pdfResponse.body()).equals(pdf("um"))).toBe(true);
    const pngResponse = await page.request.get((await page.getByRole("link", { name: "Abrir foto lesão.png" }).getAttribute("href"))!);
    expect(pngResponse.status()).toBe(200);
    expect(pngResponse.headers()["content-disposition"]).toMatch(/^inline;/);
    expect((await pngResponse.body()).equals(PNG)).toBe(true);

    // remover o PDF, com a confirmação
    await page.getByRole("button", { name: "Remover Ressonância joelho.pdf" }).click();
    await expect(page.getByText(/o registro e o arquivo ficam guardados/)).toBeVisible();
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Ressonância joelho.pdf")).toHaveCount(0);
    await expect(page.getByText("foto lesão.png")).toBeVisible();
    // o autor não abre mais o que removeu
    expect((await page.request.get(pdfHref)).status()).toBe(404);

    state = await attachmentsState(tag);
    expect(state.attachments.map((a) => [a.name, a.removed])).toEqual([
      ["Ressonância joelho.pdf", true],
      ["foto lesão.png", false],
    ]);
    const actions = state.log.map((row) => row.action);
    for (const action of ["upload_attachment", "read_attachment", "remove_attachment", "read_history"]) expect(actions).toContain(action);
    expect(actions.filter((a) => a === "upload_attachment")).toHaveLength(2);
    expect(actions.filter((a) => a === "read_attachment")).toHaveLength(2);
    expect(state.log.every((row) => row.role === "professional")).toBe(true);
  });

  asProfessional("um arquivo disfarçado (SVG com nome .pdf) é recusado e nada é gravado", async ({ page }) => {
    await page.goto(`/pacientes/${await patientIdByName(patients.own.name)}`);
    await page.getByRole("button", { name: "Anexar arquivo" }).click();
    await page.getByLabel("Arquivo", { exact: true }).setInputFiles({
      name: "laudo.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    });
    await page.getByRole("button", { name: "Anexar", exact: true }).click();
    await expect(page.getByText("Tipo de arquivo não permitido. Envie PDF, JPEG, PNG ou WebP.")).toBeVisible();
    await expect(page.getByLabel("Arquivo", { exact: true })).toBeVisible(); // a gaveta continua aberta
    expect((await attachmentsState(tag)).attachments).toEqual([]);
  });

  asProfessional("o mesmo arquivo duas vezes: a segunda é recusada com mensagem clara", async ({ page }) => {
    await page.goto(`/pacientes/${await patientIdByName(patients.own.name)}`);
    for (const attempt of [1, 2]) {
      await page.getByRole("button", { name: "Anexar arquivo" }).click();
      await page.getByLabel("Arquivo", { exact: true }).setInputFiles({ name: "igual.pdf", mimeType: "application/pdf", buffer: pdf("igual") });
      await page.getByRole("button", { name: "Anexar", exact: true }).click();
      if (attempt === 1) await expect(page.getByRole("link", { name: "Baixar igual.pdf" })).toBeVisible();
    }
    await expect(page.getByText("Este arquivo já foi anexado a este paciente.")).toBeVisible();
    expect((await attachmentsState(tag)).attachments).toHaveLength(1);
  });

  asProfessional("o anexo do colega no MESMO paciente não aparece, nem no código da página, e a rota dele dá 404", async ({ page }) => {
    await seedClinicalAttachment({ patientName: patients.own.name, professionalName: seeded.own.name, authorProfileId: loginProfileId, name: "Meu exame.pdf" });
    const colleagueId = await seedClinicalAttachment({
      patientName: patients.own.name,
      professionalName: seeded.colleague.name,
      authorProfileId: loginProfileId,
      name: SECRET_NAME,
    });
    const patientId = await patientIdByName(patients.own.name);
    await page.goto(`/pacientes/${patientId}`);
    await expect(page.getByText("Meu exame.pdf")).toBeVisible();
    await expect(page.getByText(SECRET_NAME)).toHaveCount(0);
    expect(await page.content()).not.toContain(SECRET_NAME);
    expect((await page.request.get(`/pacientes/${patientId}/anexos/${colleagueId}`)).status()).toBe(404);
    // só a leitura do histórico (nenhuma abertura do anexo do colega)
    expect((await attachmentsState(tag)).log.map((row) => row.action)).toEqual(["read_history"]);
  });
});

function describeStaff(role: "admin" | "reception") {
  const test = testAs(role);
  test.describe(`anexos: ${role === "admin" ? "o admin" : "a recepção"}`, () => {
    test.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

    let tag = "";
    let patientName = "";
    let keptId = "";
    test.beforeEach(async ({}, testInfo) => {
      tag = catalogTag();
      const createdBy = await profileIdByEmail(readUsers()[`${testInfo.project.name}-${role}`]?.email ?? "");
      const seeded = await seedProfessionals(tag);
      const patients = await seedPatients(tag, seeded);
      patientName = patients.own.name;
      keptId = await seedClinicalAttachment({ patientName, professionalName: seeded.own.name, authorProfileId: createdBy, name: SECRET_NAME });
      await seedClinicalAttachment({ patientName, professionalName: seeded.own.name, authorProfileId: createdBy, name: "Removido por engano.pdf", removed: true });
    });
    test.afterEach(async () => {
      if (!tag) return;
      await deletePatients(tag);
      await deleteProfessionals(tag);
      await deleteCatalog(tag);
      tag = "";
    });

    if (role === "reception") {
      test("a ficha NÃO tem o cartão Anexos, não mostra o nome do arquivo (nem no código da página), a rota dá redirecionamento e nada é registrado", async ({ page }) => {
        const patientId = await patientIdByName(patientName);
        await page.goto(`/pacientes/${patientId}`);
        await expect(page.getByRole("heading", { name: patientName })).toBeVisible();
        await expect(page.getByRole("heading", { name: "Anexos" })).toHaveCount(0);
        expect(await page.content()).not.toContain(SECRET_NAME);
        const direct = await page.request.get(`/pacientes/${patientId}/anexos/${keptId}`, { maxRedirects: 0 });
        expect(direct.status()).toBe(307);
        expect(direct.headers()["location"]).toContain("/dashboard");
        expect((await attachmentsState(tag)).log).toEqual([]);
      });
    } else {
      test("lê a lista (inclusive o removido, marcado), só leitura, e a abertura fica registrada com o papel admin", async ({ page }) => {
        const patientId = await patientIdByName(patientName);
        await page.goto(`/pacientes/${patientId}`);
        await expect(page.getByRole("heading", { name: "Anexos" })).toBeVisible();
        await expect(page.getByText(SECRET_NAME)).toBeVisible();
        await expect(page.getByText("Removido por engano.pdf")).toBeVisible();
        await expect(page.getByText(/Removido em/)).toBeVisible();
        for (const name of [/Anexar arquivo/, /Remover /]) await expect(page.getByRole("button", { name })).toHaveCount(0);
        // abrir: o acesso é registrado ANTES de entregar; como o arquivo semeado não existe no Storage, a rota responde 503
        const opened = await page.request.get(`/pacientes/${patientId}/anexos/${keptId}`);
        expect(opened.status()).toBe(503);
        const log = (await attachmentsState(tag)).log;
        expect(log.map((row) => row.action).sort()).toEqual(["read_attachment", "read_history"]);
        expect(log.every((row) => row.role === "admin")).toBe(true);
      });
    }
  });
}

describeStaff("admin");
describeStaff("reception");
