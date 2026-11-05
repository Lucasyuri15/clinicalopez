import fs from "node:fs";
import path from "node:path";

import { expect, test as base, type Page } from "@playwright/test";

import type { Role } from "./db";
import { currentCode } from "./totp";

export const ROLES: readonly Role[] = ["admin", "reception", "professional"];
export const PROJECTS = ["desktop", "mobile"] as const;

const AUTH_DIR = path.join(process.cwd(), "e2e", ".auth");
export const authFile = (project: string, role: Role) =>
  path.join(AUTH_DIR, `${project}-${role}.json`);
export const usersFile = path.join(AUTH_DIR, "users.json");

export type FixtureUser = {
  email: string;
  password: string;
  secret: string;
  fullName: string;
};
export type UsersFile = Record<string, FixtureUser>; // chave: `${project}-${role}`

export function ensureAuthDir() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
}

export function readUsers(): UsersFile {
  return JSON.parse(fs.readFileSync(usersFile, "utf8")) as UsersFile;
}

/** `test` já autenticado como o papel informado (sessão criada pelo projeto `setup`). */
export function testAs(role: Role) {
  return base.extend({
    // (o parâmetro não se chama `use` para o ESLint do React não confundir com hook)
    storageState: async ({}, provide, testInfo) => {
      await provide(authFile(testInfo.project.name, role));
    },
  });
}

export async function fillLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

/**
 * Primeiro acesso de um usuário: login → cadastro do 2FA → app. Devolve a chave
 * TOTP (para os próximos logins) e o código usado (para não repetir).
 */
export async function loginAndEnroll(
  page: Page,
  email: string,
  password: string,
  landing: RegExp = /\/dashboard$/,
): Promise<{ secret: string; usedCode: string }> {
  await fillLogin(page, email, password);
  await expect(page).toHaveURL(/\/mfa\/enroll$/);
  await page.getByRole("button", { name: "Gerar QR Code" }).click();
  const secretText = await page.getByTestId("mfa-secret").innerText();
  const secret = secretText.replace(/\s+/g, "");
  const usedCode = currentCode(secret);
  await page.getByLabel("Código de 6 dígitos").fill(usedCode);
  await page.getByRole("button", { name: "Confirmar e entrar" }).click();
  await expect(page).toHaveURL(landing);
  return { secret, usedCode };
}
