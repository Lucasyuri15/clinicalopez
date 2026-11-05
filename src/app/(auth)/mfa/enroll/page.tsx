import type { Metadata } from "next";
import { Suspense } from "react";

import { AuthCard } from "@/components/auth/auth-card";
import { LogoutButton } from "@/components/auth/logout-button";
import { MfaEnroll } from "@/components/auth/mfa-enroll";
import { StepGate } from "@/server/auth/step-gate";

export const metadata: Metadata = { title: "Proteger a conta" };

export default function MfaEnrollPage() {
  return (
    <AuthCard
      title="Proteja sua conta"
      description="Para entrar, usamos também um código do seu celular (verificação em duas etapas)."
    >
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <StepGate expected="mfa-enroll">
          <MfaEnroll />
        </StepGate>
      </Suspense>
      <LogoutButton variant="ghost" className="w-full" />
    </AuthCard>
  );
}
