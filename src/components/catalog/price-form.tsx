"use client";

import { useActionState } from "react";

import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCentsForInput } from "@/lib/money";
import { removePriceAction, setPriceAction } from "@/server/catalog/actions";

/**
 * Valor de um serviço (particular se `insuranceId` for null), editável só pelo administrador.
 * O valor é validado e gravado no servidor; aqui só há o campo e as mensagens.
 */
export function PriceForm({
  serviceId,
  serviceName,
  insuranceId,
  price,
}: {
  serviceId: string;
  serviceName: string;
  insuranceId: string | null;
  /** Valor atual (centavos) com o id, ou null se ainda não há valor. */
  price: { id: string; priceCents: number } | null;
}) {
  const [state, action, pending] = useActionState(setPriceAction, undefined);
  const inputId = `price-${serviceId}-${insuranceId ?? "particular"}`;

  return (
    <div className="flex flex-col gap-1.5">
      <form action={action} className="flex items-end gap-2" noValidate>
        <input type="hidden" name="serviceId" value={serviceId} />
        <input type="hidden" name="insuranceId" value={insuranceId ?? ""} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
            Valor (R$) de {serviceName}
          </label>
          <Input
            id={inputId}
            name="price"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            defaultValue={state?.values?.price ?? (price ? formatCentsForInput(price.priceCents) : "")}
            aria-invalid={state?.error ? true : undefined}
            className="max-w-40"
            required
          />
        </div>
        <Button type="submit" size="sm" disabled={pending} className="h-11 md:h-8">
          {pending ? "Salvando…" : "Salvar valor"}
        </Button>
      </form>
      {price ? (
        <form action={removePriceAction}>
          <input type="hidden" name="id" value={price.id} />
          <Button type="submit" variant="ghost" size="xs" className="h-10 md:h-6" aria-label={`Remover valor de ${serviceName}`}>
            Remover valor
          </Button>
        </form>
      ) : null}
      <FormError message={state?.error} />
      {/* Só enquanto o valor existe: depois de "Remover valor" a mensagem antiga some. */}
      {state?.success && price ? (
        <p role="status" className="text-sm text-muted-foreground">
          Valor salvo.
        </p>
      ) : null}
    </div>
  );
}
