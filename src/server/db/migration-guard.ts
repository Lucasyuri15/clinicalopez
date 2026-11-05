/**
 * Trava de segurança das migrações: só roda contra o projeto Supabase
 * explicitamente permitido (MIGRATION_PROJECT_REF). Falha fechada: sem a
 * variável, ou com projeto diferente/desconhecido, recusa.
 *
 * Sem `server-only` de propósito: o drizzle-kit carrega este módulo fora do Next.
 * As mensagens citam só o ref do projeto, nunca a URL (ela contém a senha).
 */

/** Extrai o ref do projeto de uma URL do Supabase (pooler ou conexão direta). */
export function extractProjectRef(connectionUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(connectionUrl);
  } catch {
    return null;
  }

  // Pooler: usuário "postgres.<ref>" (ou "<papel>.<ref>").
  const user = decodeURIComponent(url.username);
  const dot = user.indexOf(".");
  if (dot > 0 && dot < user.length - 1) return user.slice(dot + 1);

  // Conexão direta: host "db.<ref>.supabase.co".
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(url.hostname);
  return direct?.[1] ?? null;
}

export function assertMigrationTarget(
  connectionUrl: string,
  allowedRef: string | undefined,
): void {
  if (!allowedRef) {
    throw new Error(
      "MIGRATION_PROJECT_REF não definido. Informe o ref do projeto Supabase onde as migrações podem rodar (ex.: o de dev) no .env.local.",
    );
  }

  const targetRef = extractProjectRef(connectionUrl);
  if (!targetRef) {
    throw new Error(
      "Não foi possível identificar o projeto Supabase em DIRECT_URL; migração recusada por segurança.",
    );
  }

  if (targetRef !== allowedRef) {
    throw new Error(
      `DIRECT_URL aponta para outro projeto (${targetRef}), mas só é permitido migrar ${allowedRef}. Migração recusada.`,
    );
  }
}
