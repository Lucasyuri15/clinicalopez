import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/page-placeholder";

export const metadata: Metadata = { title: "Serviços" };

export default function ServicosPage() {
  return (
    <PagePlaceholder
      title="Serviços"
      description="Procedimentos, durações e valores."
    />
  );
}
