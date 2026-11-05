import { Button } from "@/components/ui/button";
import { logout } from "@/server/auth/actions";

export function LogoutButton({
  variant = "outline",
  className,
}: {
  variant?: "outline" | "ghost";
  className?: string;
}) {
  return (
    <form action={logout}>
      <Button type="submit" variant={variant} className={className}>
        Sair
      </Button>
    </form>
  );
}
