import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/page-placeholder";

export const metadata: Metadata = { title: "Profissionais" };

export default function ProfissionaisPage() {
  return (
    <PagePlaceholder
      title="Profissionais"
      description="Profissionais de saúde e grade de horários."
    />
  );
}
