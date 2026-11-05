import fs from "node:fs";
import path from "node:path";

import { test as teardown } from "@playwright/test";

import { deleteFixtureUsers } from "./support/db";
import { HAS_SUPABASE } from "./support/env";

teardown.skip(!HAS_SUPABASE, "Sem .env.local do Supabase dev.");

teardown("apaga usuários fictícios e sessões salvas", async () => {
  await deleteFixtureUsers();
  fs.rmSync(path.join(process.cwd(), "e2e", ".auth"), { recursive: true, force: true });
});
