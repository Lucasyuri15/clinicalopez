/**
 * SQLSTATE de um erro do Postgres (procura também em `cause`, onde o Drizzle embrulha o erro
 * do driver): `42501` sem permissão/RLS, `23505` duplicata, `23514` check, `23503` chave
 * estrangeira. Sem `server-only`: é usado também pelos testes.
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Nome da restrição que falhou (`constraint_name` do erro do Postgres), também dentro de
 * `cause`. Serve para distinguir QUAL índice único foi violado (ex.: nome repetido ou login
 * já vinculado), que têm o mesmo SQLSTATE 23505.
 */
export function pgConstraintName(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const name = (current as { constraint_name?: unknown }).constraint_name;
    if (typeof name === "string" && name !== "") return name;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
