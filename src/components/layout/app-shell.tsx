import type { ReactNode } from "react";

import { Brand } from "@/components/layout/brand";
import { MobileNav } from "@/components/layout/mobile-nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-foreground focus:px-3 focus:py-2 focus:text-background"
      >
        Pular para o conteúdo
      </a>

      <MobileNav />

      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <Brand size={96} />
        <SidebarNav />
      </aside>

      <main id="conteudo" className="flex-1 p-4 md:p-8">
        {children}
      </main>
    </div>
  );
}
