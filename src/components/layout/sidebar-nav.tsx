"use client";

import { cn } from "cn";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActiveRoute, NAV_ITEMS } from "@/lib/navigation";

type SidebarNavProps = {
  /** Chamado ao navegar (ex.: fechar a gaveta no celular). */
  onNavigate?: () => void;
};

export function SidebarNav({ onNavigate }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Principal">
      <ul className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActiveRoute(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground outline-none transition-colors",
                  "hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-sidebar-ring/50",
                  active &&
                    "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary",
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
