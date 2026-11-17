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
import { NAME_MAX } from "@/lib/catalog/schemas";
import { formatPhone } from "@/lib/phone";
import { councilLabel } from "@/lib/professionals/labels";
import { REGISTRATION_MAX } from "@/lib/professionals/schemas";
import { saveProfessional, type ProfessionalFormState } from "@/server/professionals/actions";

export type SheetService = { id: string; name: string; specialty: Specialty; active: boolean };
export type SheetProfile = { id: string; fullName: string; active: boolean };
export type EditableProfessional = {
  id: string;
  fullName: string;
  specialty: Specialty;
  registration: string | null;
  phone: string | null;
  email: string | null;
  profileId: string | null;
  serviceIds: string[];
};

type Props = {
  professional?: EditableProfessional;
  /** Todos os serviços não removidos (a lista mostrada depende da especialidade escolhida). */
  services: SheetService[];
  /** Logins que podem ser escolhidos: os livres e o atual deste profissional. */
  profiles: SheetProfile[];
};

/** Criar ou editar um profissional (só administrador), numa gaveta lateral. */
export function ProfessionalSheet({ professional, services, profiles }: Props) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(professional);

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
            {editing ? "Editar" : "Novo profissional"}
          </Button>
        }
        aria-label={editing ? `Editar ${professional?.fullName}` : undefined}
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Editar profissional" : "Novo profissional"}</SheetTitle>
          <SheetDescription>
            Dados, login de acesso e serviços que realiza. A grade de horários vem em outra etapa.
          </SheetDescription>
        </SheetHeader>
        {/* Formulário DENTRO da gaveta: ao reabrir ele nasce limpo, sem erro nem texto antigo. */}
        <ProfessionalForm
          professional={professional}
          services={services}
          profiles={profiles}
          onSaved={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

function ProfessionalForm({ professional, services, profiles, onSaved }: Props & { onSaved: () => void }) {
  const [state, action, pending] = useActionState(
    async (previous: ProfessionalFormState, formData: FormData) => {
      const result = await saveProfessional(previous, formData);
      if (result?.success) onSaved();
      return result;
    },
    undefined,
  );
  const values = state?.values;
  const [specialty, setSpecialty] = useState<string>(professional?.specialty ?? "");
  const council = (SPECIALTIES as readonly string[]).includes(specialty) ? councilLabel(specialty as Specialty) : null;

  // Serviços já marcados: o que foi enviado (se houve erro) ou o que o profissional já realiza.
  const checked = new Set(values ? (values.serviceIds ?? "").split(",") : (professional?.serviceIds ?? []));
  const available = services.filter((service) => service.specialty === specialty);

  return (
    <form
      action={action}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4"
      noValidate
    >
      {professional ? <input type="hidden" name="id" value={professional.id} /> : null}
      <FormError message={state?.error} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="professional-name" className="text-sm font-medium">
          Nome completo
        </label>
        <Input
          id="professional-name"
          name="fullName"
          defaultValue={values?.fullName ?? professional?.fullName ?? ""}
          maxLength={NAME_MAX}
          autoComplete="off"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="professional-specialty" className="text-sm font-medium">
          Especialidade
        </label>
        {/* `key`: o React só marca a opção padrão de um <select> ao MONTAR; sem remontar, a limpeza
            do formulário depois de um erro voltaria a escolha para o valor antigo. */}
        <NativeSelect
          key={values?.specialty ?? "inicial"}
          id="professional-specialty"
          name="specialty"
          defaultValue={values?.specialty || professional?.specialty || ""}
          onChange={(event) => setSpecialty(event.target.value)}
          required
        >
          <option value="" disabled>
            Escolha…
          </option>
          {SPECIALTIES.map((item) => (
            <option key={item} value={item}>
              {specialtyLabel(item)}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="professional-registration" className="text-sm font-medium">
          Registro profissional{council ? ` (${council})` : ""}
        </label>
        <Input
          id="professional-registration"
          name="registration"
          defaultValue={values?.registration ?? professional?.registration ?? ""}
          maxLength={REGISTRATION_MAX}
          autoComplete="off"
          aria-describedby="professional-registration-help"
        />
        <p id="professional-registration-help" className="text-xs text-muted-foreground">
          Opcional. O número no conselho da categoria.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="professional-phone" className="text-sm font-medium">
          Telefone
        </label>
        <Input
          id="professional-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          defaultValue={values?.phone ?? (professional?.phone ? formatPhone(professional.phone) : "")}
          autoComplete="off"
          placeholder="(11) 91234-5678"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="professional-email" className="text-sm font-medium">
          E-mail
        </label>
        <Input
          id="professional-email"
          name="email"
          type="email"
          inputMode="email"
          defaultValue={values?.email ?? professional?.email ?? ""}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="professional-login" className="text-sm font-medium">
          Login de acesso
        </label>
        <NativeSelect
          key={values?.profileId ?? "inicial"}
          id="professional-login"
          name="profileId"
          defaultValue={values?.profileId ?? professional?.profileId ?? ""}
          aria-describedby="professional-login-help"
        >
          <option value="">Sem login vinculado</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.fullName}
              {profile.active ? "" : " (inativo)"}
            </option>
          ))}
        </NativeSelect>
        <p id="professional-login-help" className="text-xs text-muted-foreground">
          O login é criado à parte, pelo administrador do sistema. Aqui só se escolhe um que já exista.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Serviços que realiza</legend>
        {specialty === "" ? (
          <p className="text-sm text-muted-foreground">Escolha a especialidade para ver os serviços.</p>
        ) : available.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum serviço de {specialtyLabel(specialty as Specialty)} cadastrado ainda.
          </p>
        ) : (
          // `key`: ao trocar a especialidade, as marcações recomeçam (serviço é de uma especialidade só).
          <ul key={`${specialty}-${values?.serviceIds ?? ""}`} className="flex flex-col gap-1">
            {available.map((service) => (
              <li key={service.id}>
                <label className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-sm">
                  <input
                    type="checkbox"
                    name="serviceIds"
                    value={service.id}
                    defaultChecked={checked.has(service.id)}
                    className="size-5 accent-brand"
                  />
                  <span>
                    {service.name}
                    {service.active ? "" : " (inativo)"}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      {/* Fixo no rodapé da rolagem: com muitos serviços o botão continua ao alcance no celular. */}
      <Button
        type="submit"
        disabled={pending}
        className="sticky bottom-0 mt-2 h-11 w-full shrink-0 text-base shadow-[0_-8px_8px_-4px_var(--color-popover)]"
      >
        {pending ? "Salvando…" : "Salvar"}
      </Button>
    </form>
  );
}
