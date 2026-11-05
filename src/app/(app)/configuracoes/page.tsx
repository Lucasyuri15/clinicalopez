import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/page-placeholder";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  await requirePageAccess("/configuracoes");
  return (
    <PagePlaceholder
      title="Configurações"
      description="Usuários, convênios e preferências da clínica."
    />
  );
}
