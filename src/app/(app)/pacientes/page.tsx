import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/page-placeholder";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Pacientes" };

export default async function PacientesPage() {
  await requirePageAccess("/pacientes");
  return (
    <PagePlaceholder
      title="Pacientes"
      description="Cadastro e histórico de pacientes."
    />
  );
}
