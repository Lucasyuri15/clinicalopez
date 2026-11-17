"use client";

import { Button } from "@/components/ui/button";

/**
 * Tela de erro das páginas internas, em português (a padrão do Next é em inglês). Aparece quando
 * algo inesperado acontece (ex.: o banco não respondeu); nada técnico é mostrado.
 */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-start gap-4 py-8" role="alert">
      <h1 className="text-2xl font-semibold md:text-3xl">Algo deu errado</h1>
      <p className="text-muted-foreground">
        Não foi possível concluir agora. Tente de novo; se continuar, avise o administrador do sistema.
      </p>
      <Button type="button" onClick={reset} className="h-11">
        Tentar de novo
      </Button>
    </div>
  );
}
