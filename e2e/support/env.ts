import { config } from "dotenv";

import { extractProjectRef } from "../../src/server/db/migration-guard";

// Os e2e de autenticação usam o Supabase DEV (usuários fictícios, apagados no fim).
// Sem .env.local completo eles são pulados.
config({ path: ".env.local", quiet: true });

const ref = process.env.MIGRATION_PROJECT_REF ?? "";

function publicHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
}

// App (URL pública), banco do app (DATABASE_URL) e conexão do dono (DIRECT_URL) precisam
// apontar para o MESMO projeto permitido; um .env.local incoerente faria o app logar num
// projeto e as fixtures irem para outro.
const SAME_PROJECT =
  ref !== "" &&
  publicHost().startsWith(`${ref}.`) &&
  extractProjectRef(process.env.DATABASE_URL ?? "") === ref &&
  extractProjectRef(process.env.DIRECT_URL ?? "") === ref;

export const HAS_SUPABASE = Boolean(
  process.env.DATABASE_URL &&
    process.env.DIRECT_URL &&
    process.env.MIGRATION_PROJECT_REF &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    SAME_PROJECT,
);
