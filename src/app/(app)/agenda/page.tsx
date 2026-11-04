import type { Metadata } from "next";

import { PagePlaceholder } from "@/components/page-placeholder";

export const metadata: Metadata = { title: "Agenda" };

export default function AgendaPage() {
  return (
    <PagePlaceholder
      title="Agenda"
      description="Calendário por profissional, com dia e semana."
    />
  );
}
