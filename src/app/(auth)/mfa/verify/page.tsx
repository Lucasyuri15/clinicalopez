import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { LogoutButton } from "@/components/auth/logout-button";
import { MfaVerifyForm } from "@/components/auth/mfa-verify-form";
import { StepGate } from "@/server/auth/step-gate";

export const metadata: Metadata = { title: "Verificação em duas etapas" };

export default function MfaVerifyPage() {
  return (
    <AuthCard
      title="Verificação em duas etapas"
      description="Digite o código de 6 dígitos que aparece no seu app autenticador."
    >
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <StepGate expected="mfa-verify">
          <MfaVerifyForm />
        </StepGate>
      </Suspense>
      <LogoutButton variant="ghost" className="w-full" />
    </AuthCard>
  );
}
