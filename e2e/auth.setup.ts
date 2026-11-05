import fs from "node:fs";

import { test as setup } from "@playwright/test";

import {
  authFile,
  ensureAuthDir,
  loginAndEnroll,
  PROJECTS,
  ROLES,
  usersFile,
  type UsersFile,
} from "./support/auth";
import {
  createFixtureUser,
  deleteFixtureUsers,
  deleteTestAttempts,
  fixtureEmail,
  newPassword,
} from "./support/db";
import { HAS_SUPABASE } from "./support/env";

const ROLE_NAMES = {
  admin: "Admin",
  reception: "Recepção",
  professional: "Profissional",
} as const;

// Um usuário por papel e por projeto (desktop/mobile) para nunca compartilhar sessão
// entre navegadores (a renovação do token em dois lugares derrubaria a sessão).
setup.describe.configure({ mode: "serial" });
setup.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev: e2e de autenticação pulados.");

setup.beforeAll(async () => {
  ensureAuthDir();
  await deleteFixtureUsers(); // restos de uma execução interrompida
  await deleteTestAttempts(); // falhas de execuções anteriores contariam na janela de 15 min
  fs.writeFileSync(usersFile, JSON.stringify({} satisfies UsersFile));
});

for (const project of PROJECTS) {
  for (const role of ROLES) {
    setup(`cria usuário e sessão: ${role} (${project})`, async ({ browser, baseURL }) => {
      setup.setTimeout(90_000);
      const email = fixtureEmail(`${project}-${role}`);
      const password = newPassword();
      const fullName = `${ROLE_NAMES[role]} Fictício (${project})`;
      await createFixtureUser({ email, password, role, fullName });

      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      const { secret } = await loginAndEnroll(page, email, password);
      await context.storageState({ path: authFile(project, role) });
      await context.close();

      const users = JSON.parse(fs.readFileSync(usersFile, "utf8")) as UsersFile;
      users[`${project}-${role}`] = { email, password, secret, fullName };
      fs.writeFileSync(usersFile, JSON.stringify(users));
    });
  }
}
