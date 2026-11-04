import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/page-placeholder";

export const metadata: Metadata = { title: "Configurações" };

export default function ConfiguracoesPage() {
  return (
    <PagePlaceholder
      title="Configurações"
      description="Usuários, convênios e preferências da clínica."
    />
  );
}
