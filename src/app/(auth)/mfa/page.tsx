import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readAuthStep, STEP_PATHS } from "@/server/auth/mfa-step";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

/** Decide para onde o usuário vai: cadastrar o 2FA, informar o código ou o app. */
async function MfaRouter(): Promise<ReactNode> {
  const supabase = await createSupabaseServerClient();
  const step = await readAuthStep(supabase);
  redirect(step === null ? "/login" : STEP_PATHS[step]);
}

export default function MfaPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Verificando…</p>}>
      <MfaRouter />
    </Suspense>
  );
}
