import { Suspense, type ReactNode } from "react";

import { AuthenticatedShell } from "@/components/layout/authenticated-shell";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <p className="p-8 text-muted-foreground" role="status">
          Carregando…
        </p>
      }
    >
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}
