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
  // Profissionais: recepção vê todos; o profissional vê SÓ o próprio cadastro (a RLS devolve 1 linha).
  ["profissionais", ["admin", "reception", "professional"]],
  // Serviços: o profissional vê nome/especialidade/duração, NUNCA valores (a tela e a RLS cuidam).
  ["servicos", ["admin", "reception", "professional"]],
  // Convênios e seus valores: sem acesso do profissional.
  ["convenios", ["admin", "reception"]],
  ["configuracoes", ["admin"]],
]);

/**
 * Exceções por sub-rota: valem ANTES da regra da seção (a mais específica ganha). Só restringem
 * (a sub-rota é mais fechada que a seção): a seção continua aberta aos seus perfis para o resto.
 * Casam o caminho exato ou o que vem depois de uma barra ("/pacientes/removidosx" não casa).
 */
const SUBROUTE_ACCESS: ReadonlyMap<string, readonly UserRole[]> = new Map([
  // Reativar paciente removido: só o admin (a recepção e o profissional nem veem removidos, pela RLS).
  ["/pacientes/removidos", ["admin"]],
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
  const path = normalizePath(pathname);
  for (const [prefix, roles] of SUBROUTE_ACCESS) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return roles.includes(role);
  }
  const section = path.split("/")[1] ?? "";
  return SCREEN_ACCESS.get(section)?.includes(role) ?? false;
}

export function visibleNavItems<T extends { href: string }>(
  role: UserRole | undefined,
  items: readonly T[],
): T[] {
  return items.filter((item) => canAccess(role, item.href));
}
