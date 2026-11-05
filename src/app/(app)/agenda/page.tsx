import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/page-placeholder";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Agenda" };

export default async function AgendaPage() {
  await requirePageAccess("/agenda");
  return (
    <PagePlaceholder
      title="Agenda"
      description="Calendário por profissional, com dia e semana."
    />
  );
}
