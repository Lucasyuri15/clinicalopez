import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Lista de escolha nativa do navegador (abre o seletor do sistema no celular, funciona com
 * leitor de tela e teclado sem código extra). Mesmo visual do `Input`.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { NativeSelect }
