import { config } from "dotenv";
import postgres from "postgres";

import { assertMigrationTarget } from "../../src/server/db/migration-guard";

config({ path: ".env.local", quiet: true });

/** Sinal interno para desfazer a transação (simulação). */
export class Rollback extends Error {}

/**
 * Executa `fn` numa transação como DONO do banco (DIRECT_URL), só no projeto permitido
 * por MIGRATION_PROJECT_REF. Nunca imprime a URL nem a senha.
 */
export async function withOwnerTransaction<T>(
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const url = process.env.DIRECT_URL;
  if (!url) throw new Error("DIRECT_URL não definido no .env.local (veja .env.example).");
  assertMigrationTarget(url, process.env.MIGRATION_PROJECT_REF);

  const sql = postgres(url, {
    prepare: false,
    max: 1,
    connect_timeout: 15,
    onnotice: () => {},
  });
  try {
    return (await sql.begin(fn)) as T;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

/** m***@dominio.com — evita espalhar e-mails completos no terminal. */
export function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.slice(0, 1)}***@${domain}`;
}

export function fail(error: unknown): never {
  console.error(`Erro: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
