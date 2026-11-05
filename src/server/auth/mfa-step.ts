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

/** Passo atual do 2FA; `null` se o nível não puder ser lido (nunca assume liberação). */
export async function readAuthStep(
  supabase: SupabaseServerClient,
): Promise<AuthStep | null> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return null;
  return nextAuthStep({
    hasSession: true,
    currentLevel: data.currentLevel,
    nextLevel: data.nextLevel,
  });
}
