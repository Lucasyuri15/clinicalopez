import type { UserRole } from "@/server/db/schema";

/**
 * Matriz de acesso por tela (PRD seção 3). Rota desconhecida é NEGADA para todos
 * (falha fechada): toda tela nova precisa ser registrada aqui de propósito.
 * Autorização real continua no servidor (DAL + RLS); isto só decide telas e menu.
 */
const SCREEN_ACCESS: ReadonlyMap<string, readonly UserRole[]> = new Map([
  ["dashboard", ["admin", "reception", "professional"]],
  ["agenda", ["admin", "reception", "professional"]],
  ["pacientes", ["admin", "reception", "professional"]],
  ["financeiro", ["admin", "reception"]],
  ["profissionais", ["admin"]],
  ["servicos", ["admin"]],
  ["configuracoes", ["admin"]],
]);

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  reception: "Recepção",
  professional: "Profissional de saúde",
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role];
}

/** Remove query/hash e barras finais ("/agenda/?x=1" -> "/agenda"). */
export function normalizePath(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] ?? "";
  const trimmed = withoutQuery.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function canAccess(role: UserRole | undefined, pathname: string): boolean {
  if (!role) return false;
  const section = normalizePath(pathname).split("/")[1] ?? "";
  return SCREEN_ACCESS.get(section)?.includes(role) ?? false;
}

export function visibleNavItems<T extends { href: string }>(
  role: UserRole | undefined,
  items: readonly T[],
): T[] {
  return items.filter((item) => canAccess(role, item.href));
}
