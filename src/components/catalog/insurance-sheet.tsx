"use client";

import { PlusIcon } from "lucide-react";
import { useActionState, useState } from "react";

import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NAME_MAX } from "@/lib/catalog/schemas";
import { saveInsurance, type CatalogFormState } from "@/server/catalog/actions";

/** Criar ou editar um convênio (só administrador), numa gaveta lateral. */
export function InsuranceSheet({ insurance }: { insurance?: { id: string; name: string } }) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(insurance);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant={editing ? "outline" : "default"}
            size={editing ? "sm" : "default"}
            className={editing ? "h-10 md:h-7" : undefined}
          >
            {editing ? null : <PlusIcon aria-hidden="true" />}
            {editing ? "Editar" : "Novo convênio"}
          </Button>
        }
        aria-label={editing ? `Editar ${insurance?.name}` : undefined}
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Editar convênio" : "Novo convênio"}</SheetTitle>
          <SheetDescription>Nome do plano. Os valores por serviço ficam na página do convênio.</SheetDescription>
        </SheetHeader>
        {/* Formulário dentro da gaveta: reabrir começa limpo (sem erro nem texto antigo). */}
        <InsuranceForm insurance={insurance} onSaved={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function InsuranceForm({
  insurance,
  onSaved,
}: {
  insurance?: { id: string; name: string };
  onSaved: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (previous: CatalogFormState, formData: FormData) => {
      const result = await saveInsurance(previous, formData);
      if (result?.success) onSaved();
      return result;
    },
    undefined,
  );

  return (
    <form action={action} className="flex flex-1 flex-col gap-4 px-4 pb-4" noValidate>
      {insurance ? <input type="hidden" name="id" value={insurance.id} /> : null}
      <FormError message={state?.error} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="insurance-name" className="text-sm font-medium">
          Nome do plano
        </label>
        <Input
          id="insurance-name"
          name="name"
          defaultValue={state?.values?.name ?? insurance?.name ?? ""}
          maxLength={NAME_MAX}
          autoComplete="off"
          required
        />
      </div>
      <Button type="submit" disabled={pending} className="mt-auto h-11 w-full text-base">
        {pending ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}
