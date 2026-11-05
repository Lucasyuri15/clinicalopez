import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/page-placeholder";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Serviços" };

export default async function ServicosPage() {
  await requirePageAccess("/servicos");
  return (
    <PagePlaceholder
      title="Serviços"
      description="Procedimentos, durações e valores."
    />
  );
}
