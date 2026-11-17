"use client";

import { PlusIcon } from "lucide-react";
import { useActionState, useState } from "react";

import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SPECIALTIES, specialtyLabel, type Specialty } from "@/lib/catalog/labels";
import { DURATION_MAX, DURATION_MIN, NAME_MAX } from "@/lib/catalog/schemas";
import { saveService, type CatalogFormState } from "@/server/catalog/actions";

type EditableService = {
  id: string;
  name: string;
  specialty: Specialty;
  durationMinutes: number;
};

/** Criar ou editar um serviço (só administrador), numa gaveta lateral. */
export function ServiceSheet({ service }: { service?: EditableService }) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(service);

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
            {editing ? "Editar" : "Novo serviço"}
          </Button>
        }
        aria-label={editing ? `Editar ${service?.name}` : undefined}
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Editar serviço" : "Novo serviço"}</SheetTitle>
          <SheetDescription>
            Nome, especialidade e duração. O valor é cadastrado na lista.
          </SheetDescription>
        </SheetHeader>
        {/* O formulário (e seu estado: erro e valores digitados) vive DENTRO da gaveta: ao fechar
            e reabrir ele nasce limpo, sem erro nem texto de uma tentativa anterior. */}
        <ServiceForm service={service} onSaved={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function ServiceForm({ service, onSaved }: { service?: EditableService; onSaved: () => void }) {
  const [state, action, pending] = useActionState(
    async (previous: CatalogFormState, formData: FormData) => {
      const result = await saveService(previous, formData);
      if (result?.success) onSaved();
      return result;
    },
    undefined,
  );

  return (
    <form action={action} className="flex flex-1 flex-col gap-4 px-4 pb-4" noValidate>
      {service ? <input type="hidden" name="id" value={service.id} /> : null}
      <FormError message={state?.error} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="service-name" className="text-sm font-medium">
          Nome
        </label>
        <Input
          id="service-name"
          name="name"
          defaultValue={state?.values?.name ?? service?.name ?? ""}
          maxLength={NAME_MAX}
          autoComplete="off"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="service-specialty" className="text-sm font-medium">
          Especialidade
        </label>
        {/* `key`: o React só marca a opção padrão de um <select> ao MONTAR; sem remontar, a limpeza
            do formulário depois de um erro voltaria a escolha para o valor antigo. */}
        <NativeSelect
          key={state?.values?.specialty ?? "inicial"}
          id="service-specialty"
          name="specialty"
          defaultValue={state?.values?.specialty || service?.specialty || ""}
          required
        >
          <option value="" disabled>
            Escolha…
          </option>
          {SPECIALTIES.map((specialty) => (
            <option key={specialty} value={specialty}>
              {specialtyLabel(specialty)}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="service-duration" className="text-sm font-medium">
          Duração (minutos)
        </label>
        <Input
          id="service-duration"
          name="durationMinutes"
          inputMode="numeric"
          defaultValue={
            state?.values?.durationMinutes ?? (service ? String(service.durationMinutes) : "")
          }
          autoComplete="off"
          aria-describedby="service-duration-help"
          required
        />
        <p id="service-duration-help" className="text-xs text-muted-foreground">
          De {DURATION_MIN} a {DURATION_MAX} minutos.
        </p>
      </div>

      <Button type="submit" disabled={pending} className="mt-auto h-11 w-full text-base">
        {pending ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}
