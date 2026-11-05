import "server-only";

import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { readAuthStep, STEP_PATHS } from "./mfa-step";

/**
 * Só renderiza `children` se o usuário estiver exatamente no passo esperado do 2FA;
 * caso contrário redireciona para onde ele deveria estar. Lê cookies: use dentro de
 * <Suspense> (Cache Components). As Server Actions revalidam o passo de novo.
 */
export async function StepGate({
  expected,
  children,
}: {
  expected: "mfa-enroll" | "mfa-verify";
  children: ReactNode;
}) {
  const supabase = await createSupabaseServerClient();
  const step = await readAuthStep(supabase);
  if (step === null) redirect("/login");
  if (step !== expected) redirect(STEP_PATHS[step]);
  return <>{children}</>;
}
