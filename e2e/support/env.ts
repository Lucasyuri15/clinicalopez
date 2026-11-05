import { config } from "dotenv";

// Os e2e de autenticação usam o Supabase DEV (usuários fictícios, apagados no fim).
// Sem .env.local completo eles são pulados.
config({ path: ".env.local", quiet: true });

export const HAS_SUPABASE = Boolean(
  process.env.DATABASE_URL &&
    process.env.DIRECT_URL &&
    process.env.MIGRATION_PROJECT_REF &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
