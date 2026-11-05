import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/page-placeholder";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Profissionais" };

export default async function ProfissionaisPage() {
  await requirePageAccess("/profissionais");
  return (
    <PagePlaceholder
      title="Profissionais"
      description="Profissionais de saúde e grade de horários."
    />
  );
}
