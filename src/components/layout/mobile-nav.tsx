"use client";

import { MenuIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Brand } from "@/components/layout/brand";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type MobileNavProps = {
  allowedHrefs: readonly string[];
  /** Nome, papel e botão Sair (renderizados no servidor). */
  account: ReactNode;
};

export function MobileNav({ allowedHrefs, account }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between bg-sidebar px-4 py-2 md:hidden">
      <Brand size={44} />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="icon-lg"
              aria-label="Abrir menu"
              className="text-sidebar-foreground hover:bg-sidebar-accent"
            />
          }
        >
          <MenuIcon className="size-6" aria-hidden="true" />
        </SheetTrigger>
        <SheetContent side="left" className="bg-sidebar text-sidebar-foreground">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription className="text-sidebar-foreground/80">
              Navegação principal
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 px-3 pb-4">
            <SidebarNav
              allowedHrefs={allowedHrefs}
              onNavigate={() => setOpen(false)}
            />
            <div className="mt-auto">{account}</div>
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
