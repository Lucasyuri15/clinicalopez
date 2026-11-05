import "server-only";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";

import { canAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { profiles, type UserRole } from "@/server/db/schema";
import { withUser } from "@/server/db/with-user";

/**
 * Camada de acesso a dados (DAL) de autenticação: a defesa PRINCIPAL de telas e ações.
 * O `proxy` é só uma checagem otimista. Chame `requireUser`/`requireRole`/
 * `requirePageAccess` em toda página, Server Action e Route Handler que não seja pública.
 */

export type SessionUser = { userId: string; role: UserRole; fullName: string };

export type SessionState =
  | { status: "anonymous" } // sem sessão válida OU 2FA ainda pendente (aal1)
  | { status: "no-profile" } // sessão aal2 válida, mas sem perfil ativo
  | { status: "ok"; user: SessionUser };

const ACCESS_DENIED = "/dashboard?acesso=negado";

/**
 * Valida o JWT (`getClaims`: assinatura via JWKS), exige `aal2` e carrega o perfil
 * COMO o próprio usuário (`withUser`, sob RLS: perfil inativo/removido não aparece).
 * Memoizada por renderização com `cache`.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = error ? null : data?.claims;
  if (!claims || claims.aal !== "aal2" || !claims.sub) {
    return { status: "anonymous" };
  }

  const userId = claims.sub;
  const rows = await withUser({ userId }, (tx) =>
    tx
      .select({ role: profiles.role, fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1),
  );
  const profile = rows[0];
  if (!profile) return { status: "no-profile" };

  return {
    status: "ok",
    user: { userId, role: profile.role, fullName: profile.fullName },
  };
});

/** Exige usuário autenticado (aal2) com perfil. Redireciona caso contrário. */
export async function requireUser(): Promise<SessionUser> {
  const state = await getSessionState();
  // `no-profile` NÃO vai para /login: o proxy devolveria o aal2 ao dashboard (laço).
  if (state.status === "no-profile") redirect("/sem-acesso");
  if (state.status !== "ok") redirect("/login");
  return state.user;
}

/** Exige um dos papéis informados. */
export async function requireRole(...roles: UserRole[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(ACCESS_DENIED);
  return user;
}

/** Exige acesso à tela (matriz em `src/lib/auth/access.ts`). */
export async function requirePageAccess(pathname: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAccess(user.role, pathname)) redirect(ACCESS_DENIED);
  return user;
}
