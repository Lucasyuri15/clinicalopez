import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/page-placeholder";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Financeiro" };

export default async function FinanceiroPage() {
  await requirePageAccess("/financeiro");
  return (
    <PagePlaceholder
      title="Financeiro"
      description="Cobranças particulares e de convênios."
    />
  );
}
