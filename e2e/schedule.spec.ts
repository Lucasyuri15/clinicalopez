import { expect, type Page } from "@playwright/test";

import { testAs } from "./support/auth";
import {
  catalogTag,
  deleteCatalog,
  deleteProfessionals,
  scheduleState,
  seedProfessionals,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

const H = (hours: number, minutes = 0) => hours * 60 + minutes;
const card = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });
/** AAAA-MM-DD de hoje + `days` (em UTC: a margem de um dia não importa para estes testes). */
const isoIn = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------
// Admin e recepção: montam a semana e as folgas pela tela; o banco confirma o que foi gravado.
// (A recepção opera a grade no dia a dia; o que o PROFISSIONAL vê, só leitura, está em
// `professional-role.spec.ts`.)
// ---------------------------------------------------------------------------------------------
function describeSchedule(role: "admin" | "reception") {
const asStaff = testAs(role);
asStaff.describe(`perfil ${role}: grade de horários`, () => {
  asStaff.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");
  asStaff.skip(({ isMobile }) => isMobile, "somente no desktop");

  let tag = "";
  let seeded: Awaited<ReturnType<typeof seedProfessionals>>;
  asStaff.beforeEach(async () => {
    tag = catalogTag();
    seeded = await seedProfessionals(tag);
  });
  asStaff.afterEach(async () => {
    if (!tag) return;
    await deleteProfessionals(tag);
    await deleteCatalog(tag);
    tag = "";
  });

  async function openSchedule(page: Page) {
    await page.goto("/profissionais");
    await card(page, seeded.own.name).getByRole("link", { name: `Ver horários de ${seeded.own.name}` }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`Horários de ${seeded.own.name}`);
  }

  asStaff("monta a semana com intervalo, recusa sobreposição em português e confirma no banco", async ({ page }) => {
    asStaff.setTimeout(90_000); // fluxo longo, com admin e recepção em paralelo no servidor de dev
    await openSchedule(page);
    const monday = page.getByRole("group", { name: "Segunda-feira" });
    await expect(monday).toContainText("Sem atendimento");

    // duas faixas na segunda, com intervalo (08–12 e 14–18)
    await monday.getByRole("button", { name: "Adicionar faixa em Segunda-feira" }).click();
    await monday.getByRole("button", { name: "Adicionar faixa em Segunda-feira" }).click();
    await monday.getByLabel("Segunda-feira, faixa 2, início").fill("14:00");
    await monday.getByLabel("Segunda-feira, faixa 2, fim").fill("18:00");
    await page.getByRole("group", { name: "Sábado" }).getByRole("button", { name: "Adicionar faixa em Sábado" }).click();
    await page.getByRole("button", { name: "Salvar horários" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Horários salvos." })).toBeVisible();
    expect((await scheduleState(seeded.own.name)).hours).toEqual([
      { weekday: 1, start: H(8), end: H(12) },
      { weekday: 1, start: H(14), end: H(18) },
      { weekday: 6, start: H(8), end: H(12) },
    ]);

    // recarregar mostra o que foi salvo
    await page.reload();
    await expect(page.getByLabel("Segunda-feira, faixa 2, início")).toHaveValue("14:00");

    // faixa sobreposta: mensagem em português e NADA muda no banco
    await monday.getByRole("button", { name: "Adicionar faixa em Segunda-feira" }).click();
    await monday.getByLabel("Segunda-feira, faixa 3, início").fill("11:00");
    await monday.getByLabel("Segunda-feira, faixa 3, fim").fill("13:00");
    await page.getByRole("button", { name: "Salvar horários" }).click();
    await expect(page.getByTestId("form-error")).toHaveText(
      "Segunda-feira: as faixas 08:00–12:00 e 11:00–13:00 se sobrepõem.",
    );
    expect((await scheduleState(seeded.own.name)).hours).toHaveLength(3);
    await expect(page.getByRole("status").filter({ hasText: "Horários salvos." })).toHaveCount(0);

    // remove a faixa errada e remove o sábado; faixas que ENCOSTAM (12:00 e 12:00) valem
    await monday.getByRole("button", { name: "Remover faixa 3 de Segunda-feira" }).click();
    await monday.getByLabel("Segunda-feira, faixa 2, início").fill("12:00");
    await page.getByRole("group", { name: "Sábado" }).getByRole("button", { name: "Remover faixa 1 de Sábado" }).click();
    await page.getByRole("button", { name: "Salvar horários" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Horários salvos." })).toBeVisible();
    expect((await scheduleState(seeded.own.name)).hours).toEqual([
      { weekday: 1, start: H(8), end: H(12) },
      { weekday: 1, start: H(12), end: H(18) },
    ]);
  });

  asStaff("cria folga de dia inteiro e bloqueio parcial, valida em português e remove", async ({ page }) => {
    asStaff.setTimeout(90_000);
    await openSchedule(page);
    const reason = `${tag} Recesso`;
    const form = page.getByRole("heading", { name: "Adicionar folga ou bloqueio" }).locator("..");

    // dia inteiro (3 dias)
    await form.getByLabel("Data de início").fill(isoIn(40));
    await form.getByLabel("Data de término").fill(isoIn(42));
    await form.getByLabel("Motivo (opcional)").fill(reason);
    await form.getByRole("button", { name: "Adicionar folga ou bloqueio" }).click();
    await expect(form.getByRole("status")).toHaveText("Adicionado.");
    const item = page.getByRole("listitem").filter({ hasText: reason });
    await expect(item).toContainText("(dia inteiro)");
    const state = await scheduleState(seeded.own.name);
    expect(state.timeOff.map((x) => x.reason)).toContain(reason);

    // término antes do início: mensagem em português e o que foi digitado continua
    await form.getByLabel("Data de início").fill(isoIn(50));
    await form.getByLabel("Data de término").fill(isoIn(48));
    await form.getByLabel("Motivo (opcional)").fill("Outro");
    await form.getByRole("button", { name: "Adicionar folga ou bloqueio" }).click();
    await expect(page.getByTestId("form-error").first()).toHaveText("A data de término não pode ser antes da de início.");
    await expect(form.getByLabel("Data de início")).toHaveValue(isoIn(50));
    await expect(form.getByLabel("Motivo (opcional)")).toHaveValue("Outro");
    expect((await scheduleState(seeded.own.name)).timeOff).toHaveLength(state.timeOff.length);

    // bloqueio parcial: desmarca "Dia inteiro" e informa os horários
    await form.getByLabel("Data de término").fill(isoIn(50));
    await form.getByLabel("Dia inteiro").uncheck();
    await form.getByLabel("Horário de início").fill("14:00");
    await form.getByLabel("Horário de fim").fill("18:30");
    await form.getByLabel("Motivo (opcional)").fill(`${tag} Parcial`);
    await form.getByRole("button", { name: "Adicionar folga ou bloqueio" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: `${tag} Parcial` })).toContainText("das 14:00 às 18:30");

    // remover
    await item.getByRole("button", { name: /^Remover folga/ }).click();
    await expect(page.getByRole("listitem").filter({ hasText: reason })).toHaveCount(0);
    expect((await scheduleState(seeded.own.name)).timeOff.map((x) => x.reason)).not.toContain(reason);
  });
});
}

describeSchedule("admin");
describeSchedule("reception");
