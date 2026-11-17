import { expect, type Page } from "@playwright/test";

import { readUsers, testAs } from "./support/auth";
import {
  catalogTag,
  deleteCatalog,
  deleteProfessionals,
  professionalIdByName,
  profileIdByEmail,
  seedProfessionals,
  seedSchedule,
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
  asProfessional.beforeEach(async ({}, testInfo) => {
    tag = catalogTag();
    const email = readUsers()[`${testInfo.project.name}-professional`]?.email ?? "";
    seeded = await seedProfessionals(tag, { linkProfileId: await profileIdByEmail(email) });
    schedule = await seedSchedule(seeded);
  });
  asProfessional.afterEach(async () => {
    if (!tag) return;
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
});
