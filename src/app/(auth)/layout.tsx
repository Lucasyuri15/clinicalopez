import Image from "next/image";
import type { ReactNode } from "react";

/** Telas de entrada: sem menu lateral, cartão central com a logo. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-4">
      <Image
        src="/brand/logo.png"
        alt="López + Saúde"
        width={96}
        height={96}
        priority
        className="rounded-xl"
      />
      {children}
    </main>
  );
}
