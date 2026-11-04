import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  type LucideIcon,
  Settings,
  Stethoscope,
  Users,
  Wallet,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/** Fonte única do menu: usada pela barra lateral (desktop) e pela gaveta (celular). */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agenda", label: "Agenda", icon: CalendarDays },
  { href: "/pacientes", label: "Pacientes", icon: Users },
  { href: "/profissionais", label: "Profissionais", icon: Stethoscope },
  { href: "/servicos", label: "Serviços", icon: ClipboardList },
  { href: "/financeiro", label: "Financeiro", icon: Wallet },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

/** Uma rota está ativa na própria rota ou em qualquer sub-rota (`/pacientes/123`). */
export function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
