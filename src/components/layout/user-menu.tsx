import { LogoutButton } from "@/components/auth/logout-button";
import { roleLabel } from "@/lib/auth/access";
import type { UserRole } from "@/server/db/schema";

/** Quem está logado (nome e papel) e o botão Sair. Server Component. */
export function UserMenu({
  fullName,
  role,
}: {
  fullName: string;
  role: UserRole;
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-sidebar-border pt-3">
      <div className="min-w-0 px-1">
        <p className="truncate text-sm font-semibold" title={fullName}>
          {fullName}
        </p>
        <p className="text-xs text-sidebar-foreground/80">{roleLabel(role)}</p>
      </div>
      <LogoutButton className="w-full" />
    </div>
  );
}
