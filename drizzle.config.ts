import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

import { assertMigrationTarget } from "./src/server/db/migration-guard";

config({ path: ".env.local", quiet: true });

const url = process.env.DIRECT_URL;
if (!url) {
  throw new Error("DIRECT_URL não definido no .env.local (veja .env.example).");
}
// Falha fechada: só migra o projeto permitido (nunca produção por engano).
assertMigrationTarget(url, process.env.MIGRATION_PROJECT_REF);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./src/server/db/migrations",
  dbCredentials: { url },
  schemaFilter: ["public"],
  strict: true,
  verbose: true,
});
