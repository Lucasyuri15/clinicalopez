import "server-only";

import { nextAuthStep, type AuthStep } from "@/lib/auth/steps";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

export type SupabaseServerClient = Awaited<
  ReturnType<typeof createSupabaseServerClient>
>;

export const STEP_PATHS: Record<AuthStep, string> = {
  login: "/login",
  "mfa-enroll": "/mfa/enroll",
  "mfa-verify": "/mfa/verify",
  app: "/dashboard",
};

/**
 * Passo atual do 2FA, só com fontes AUTORITATIVAS:
 * - `aal` do JWT VERIFICADO (`getClaims`, assinatura via JWKS);
 * - fatores verificados lidos do servidor (`listFactors`).
 * Não usa `getAuthenticatorAssuranceLevel`, que lê o objeto de usuário guardado no
 * cookie (não verificado). Devolve `null` se os fatores não puderem ser lidos
 * (nunca assume liberação); sem sessão válida, "login".
 */
export async function readAuthStep(
  supabase: SupabaseServerClient,
): Promise<AuthStep | null> {
  const { data, error } = await supabase.auth.getClaims();
  const claims = error ? null : data?.claims;
  if (!claims) return "login";
  if (claims.aal === "aal2") return "app";

  const { data: factors, error: factorsError } =
    await supabase.auth.mfa.listFactors();
  if (factorsError || !factors) return null;

  return nextAuthStep({
    hasSession: true,
    currentLevel: claims.aal,
    nextLevel: factors.totp.length > 0 ? "aal2" : "aal1",
  });
}
