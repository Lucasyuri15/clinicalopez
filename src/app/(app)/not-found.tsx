import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Página de "não encontrado" das telas internas (em pt-BR; a padrão do Next é em inglês). */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 py-8">
      <h1 className="text-2xl font-semibold md:text-3xl">Não encontrado</h1>
      <p className="text-muted-foreground">
        Esta página não existe ou o cadastro foi removido.
      </p>
      <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline" }))}>
        Voltar ao início
      </Link>
    </div>
  );
}
