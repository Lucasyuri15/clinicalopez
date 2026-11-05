/**
 * Trava de segurança das migrações: só roda contra o projeto Supabase
 * explicitamente permitido (MIGRATION_PROJECT_REF). Falha fechada: sem a
 * variável, ou com projeto diferente/desconhecido, recusa.
 *
 * Sem `server-only` de propósito: o drizzle-kit carrega este módulo fora do Next.
 * As mensagens citam só o ref do projeto, nunca a URL (ela contém a senha).
 */

/**
 * Extrai o ref do projeto de uma URL do Supabase, de forma ESTRITA: só aceita os
 * dois formatos conhecidos e recusa (null) qualquer coisa ambígua.
 * - Conexão direta: host `db.<ref>.supabase.co` e usuário exatamente `postgres`.
 * - Pooler: host `*.pooler.supabase.com` e usuário `<papel>.<ref>`.
 * - Qualquer outro host, ou query string (ex.: `?host=` sobrescreve o destino): null.
 */
export function extractProjectRef(connectionUrl: string): string | null {
  try {
    const url = new URL(connectionUrl);
    if (url.search !== "") return null;

    const user = decodeURIComponent(url.username);
    const host = url.hostname.toLowerCase();

    const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host);
    if (direct) return user === "postgres" ? (direct[1] ?? null) : null;

    if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(host)) {
      const dot = user.indexOf(".");
      return dot > 0 && dot < user.length - 1 ? user.slice(dot + 1) : null;
    }

    return null;
  } catch {
    return null;
  }
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
