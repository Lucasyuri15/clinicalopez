import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/page-placeholder";

export const metadata: Metadata = { title: "Financeiro" };

export default function FinanceiroPage() {
  return (
    <PagePlaceholder
      title="Financeiro"
      description="Cobranças particulares e de convênios."
    />
  );
}
