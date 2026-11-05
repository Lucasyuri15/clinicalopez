import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <AuthCard
      title="Entrar"
      description="Acesse o sistema da clínica com seu e-mail e senha."
    >
      <LoginForm />
      <p className="text-center text-sm text-muted-foreground">
        Problemas para entrar? Fale com o administrador da clínica.
      </p>
    </AuthCard>
  );
}
