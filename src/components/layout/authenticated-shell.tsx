import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/server/auth/session";

/**
 * Monta o shell com o usuário logado. Lê a sessão (cookies), então precisa ficar
 * dentro de <Suspense> (Cache Components). O layout NÃO é a defesa principal (não
 * re-renderiza a cada navegação): cada página e ação chama `requirePageAccess`.
 */
export async function AuthenticatedShell({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return <AppShell user={user}>{children}</AppShell>;
}
