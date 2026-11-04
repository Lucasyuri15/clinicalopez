import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/page-placeholder";

export const metadata: Metadata = { title: "Pacientes" };

export default function PacientesPage() {
  return (
    <PagePlaceholder
      title="Pacientes"
      description="Cadastro e histórico de pacientes."
    />
  );
}
