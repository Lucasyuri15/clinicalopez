import type { Metadata } from "next";

import { AuthCard } from "@/components/auth/auth-card";
import { LogoutButton } from "@/components/auth/logout-button";

export const metadata: Metadata = { title: "Conta sem acesso" };

/**
 * Para quem tem sessão válida (com 2FA) mas ainda não tem perfil ativo no sistema.
 * Não chama a DAL de propósito: evita laço de redirecionamento com o proxy.
 */
export default function NoAccessPage() {
  return (
    <AuthCard
      title="Conta sem acesso"
      description="Você entrou, mas sua conta ainda não está habilitada no sistema. Peça ao administrador da clínica para liberar o seu acesso."
    >
      <LogoutButton className="w-full" />
    </AuthCard>
  );
}
