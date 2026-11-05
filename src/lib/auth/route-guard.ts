import { normalizePath } from "./access";

/** Nível de garantia do JWT: aal1 = só senha; aal2 = senha + 2FA; null = sem sessão. */
export type Aal = "aal1" | "aal2" | null;

export type RouteDecision =
  | { action: "next" }
  | { action: "redirect"; to: string };

const NEXT: RouteDecision = { action: "next" };
const redirect = (to: string): RouteDecision => ({ action: "redirect", to });

/**
 * Decisão OTIMISTA do proxy: usa só o que está no JWT (sem banco). Não substitui
 * a checagem na DAL, nas páginas e nas ações. Qualquer nível desconhecido conta
 * como aal1 (nunca como autenticado) e qualquer rota fora de /login e /mfa exige aal2.
 */
export function decideRoute({
  pathname,
  aal,
}: {
  pathname: string;
  aal: Aal;
}): RouteDecision {
  const path = normalizePath(pathname);
  const isLogin = path === "/login";
  const isMfa = path === "/mfa" || path.startsWith("/mfa/");

  if (aal == null) return isLogin ? NEXT : redirect("/login");
  if (aal === "aal2") return isLogin || isMfa ? redirect("/dashboard") : NEXT;
  return isLogin || isMfa ? NEXT : redirect("/mfa");
}
