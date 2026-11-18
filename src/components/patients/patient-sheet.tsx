"use client";

import { PlusIcon } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";

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
import { specialtyLabel, type Specialty } from "@/lib/catalog/labels";
import { NAME_MAX } from "@/lib/catalog/schemas";
import { formatPhone } from "@/lib/phone";
import { isUnderAge } from "@/lib/patients/age";
import { formatCpf } from "@/lib/patients/cpf";
import { UFS } from "@/lib/patients/labels";
import { ADMIN_NOTES_MAX, NO_CPF_REASON_MAX } from "@/lib/patients/schemas";
import { savePatient, type PatientFormState } from "@/server/patients/actions";

export type SheetProfessional = { id: string; fullName: string; specialty: Specialty; active: boolean };
export type SheetInsurance = { id: string; name: string; active: boolean };
export type EditablePatient = {
  id: string;
  fullName: string;
  birthDate: string;
  phone: string | null;
  email: string | null;
  cpf: string | null;
  noCpfReason: string | null;
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  insuranceId: string | null;
  insuranceCard: string | null;
  guardianName: string | null;
  guardianRelationship: string | null;
  guardianPhone: string | null;
  guardianCpf: string | null;
  adminNotes: string | null;
  professionalIds: string[];
};

type Props = {
  patient?: EditablePatient;
  /** Profissionais que podem ser escolhidos: os ativos e os já vinculados a este paciente. */
  professionals: SheetProfessional[];
  /** Convênios não removidos. */
  insurances: SheetInsurance[];
  /** Data de hoje em Brasília ("AAAA-MM-DD"): a tela avisa quando o paciente é menor de 18 anos. */
  today: string;
  /** Chamado depois de salvar com sucesso (a lista de pacientes usa para recomeçar a busca). */
  onSaved?: () => void;
};

const FIELD = "flex flex-col gap-1.5";
const LABEL = "text-sm font-medium";
const HELP = "text-xs text-muted-foreground";
const TEXTAREA =
  "min-h-24 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

/** Criar ou editar um paciente (admin e recepção), numa gaveta lateral. */
export function PatientSheet({ patient, professionals, insurances, today, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(patient);

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
            {editing ? "Editar" : "Novo paciente"}
          </Button>
        }
        aria-label={editing ? `Editar ${patient?.fullName}` : undefined}
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{editing ? "Editar paciente" : "Novo paciente"}</SheetTitle>
          <SheetDescription>
            Dados pessoais, CPF, endereço, convênio, responsável e os profissionais que atendem este paciente.
          </SheetDescription>
        </SheetHeader>
        {/* Formulário DENTRO da gaveta: ao reabrir ele nasce limpo, sem erro nem texto antigo. */}
        <PatientForm
          patient={patient}
          professionals={professionals}
          insurances={insurances}
          today={today}
          onSaved={() => {
            setOpen(false);
            onSaved?.();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function PatientForm({ patient, professionals, insurances, today, onSaved }: Props & { onSaved: () => void }) {
  const [state, action, pending] = useActionState(
    async (previous: PatientFormState, formData: FormData) => {
      const result = await savePatient(previous, formData);
      if (result?.success) onSaved();
      return result;
    },
    undefined,
  );
  const values = state?.values;
  // O formulário longo rola dentro da gaveta e a mensagem fica no topo: sem isto, quem toca em
  // "Salvar" lá embaixo (principalmente no celular) não vê erro nenhum e acha que nada aconteceu.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state?.error) return;
    errorRef.current?.scrollIntoView({ block: "nearest" });
    errorRef.current?.focus();
  }, [state]);
  const idPrefix = `patient-${patient?.id ?? "new"}`;
  const text = (name: string, fallback: string | null | undefined) => values?.[name] ?? fallback ?? "";

  // "Sem CPF" e o convênio escolhido mudam o que aparece; o resto é campo simples.
  // Valor INICIAL da caixa (o enviado, se houve erro; senão o do cadastro). Não pode ser `checked`
  // controlado: o React limpa o formulário depois de cada ação e a caixa voltaria a desmarcada
  // no DOM enquanto o estado diz o contrário. Por isso `defaultChecked` + `key` (como nos <select>).
  const noCpfDefault = values ? values.noCpf === "on" : patient !== undefined && patient.noCpfReason !== null;
  const [noCpf, setNoCpf] = useState(noCpfDefault);
  const [insuranceId, setInsuranceId] = useState(patient?.insuranceId ?? "");
  const [birthDate, setBirthDate] = useState(patient?.birthDate ?? "");
  const minor = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && isUnderAge(birthDate, today);

  const checked = new Set(values ? (values.professionalIds ?? "").split(",") : (patient?.professionalIds ?? []));

  return (
    <form action={action} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4" noValidate>
      {patient ? <input type="hidden" name="id" value={patient.id} /> : null}
      {state?.error ? (
        <div ref={errorRef} tabIndex={-1} className="outline-none">
          <FormError message={state.error} />
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold">Dados pessoais</legend>
        <div className={FIELD}>
          <label htmlFor={`${idPrefix}-name`} className={LABEL}>
            Nome completo
          </label>
          <Input
            id={`${idPrefix}-name`}
            name="fullName"
            defaultValue={text("fullName", patient?.fullName)}
            maxLength={NAME_MAX}
            autoComplete="off"
            required
          />
        </div>
        <div className={FIELD}>
          <label htmlFor={`${idPrefix}-birth`} className={LABEL}>
            Data de nascimento
          </label>
          <Input
            id={`${idPrefix}-birth`}
            name="birthDate"
            type="date"
            min="1900-01-01"
            max={today}
            defaultValue={text("birthDate", patient?.birthDate)}
            onChange={(event) => setBirthDate(event.target.value)}
            autoComplete="off"
            required
          />
        </div>
        <div className={FIELD}>
          <label htmlFor={`${idPrefix}-phone`} className={LABEL}>
            Telefone / WhatsApp
          </label>
          <Input
            id={`${idPrefix}-phone`}
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={text("phone", patient?.phone ? formatPhone(patient.phone) : "")}
            autoComplete="off"
            placeholder="(11) 91234-5678"
          />
        </div>
        <div className={FIELD}>
          <label htmlFor={`${idPrefix}-email`} className={LABEL}>
            E-mail
          </label>
          <Input
            id={`${idPrefix}-email`}
            name="email"
            type="email"
            inputMode="email"
            defaultValue={text("email", patient?.email)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby={`${idPrefix}-contact-help`}
          />
          <p id={`${idPrefix}-contact-help`} className={HELP}>
            Informe ao menos um contato: telefone ou e-mail (para menores, o telefone do responsável vale).
          </p>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">CPF</legend>
        <label className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-sm">
          <input
            key={values ? `erro-${values.noCpf ?? ""}` : "inicial"}
            type="checkbox"
            name="noCpf"
            defaultChecked={noCpfDefault}
            onChange={(event) => setNoCpf(event.target.checked)}
            className="size-5 accent-brand"
          />
          <span>Sem CPF (por exemplo, paciente estrangeiro)</span>
        </label>
        {noCpf ? (
          <div className={FIELD}>
            <label htmlFor={`${idPrefix}-no-cpf`} className={LABEL}>
              Motivo de não ter CPF
            </label>
            <Input
              id={`${idPrefix}-no-cpf`}
              name="noCpfReason"
              defaultValue={text("noCpfReason", patient?.noCpfReason)}
              maxLength={NO_CPF_REASON_MAX}
              autoComplete="off"
              required
            />
          </div>
        ) : (
          <div className={FIELD}>
            <label htmlFor={`${idPrefix}-cpf`} className={LABEL}>
              CPF
            </label>
            <Input
              id={`${idPrefix}-cpf`}
              name="cpf"
              inputMode="numeric"
              defaultValue={text("cpf", patient?.cpf ? formatCpf(patient.cpf) : "")}
              maxLength={14}
              autoComplete="off"
              placeholder="000.000.000-00"
              required
            />
          </div>
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold">Endereço</legend>
        <div className={FIELD}>
          <label htmlFor={`${idPrefix}-cep`} className={LABEL}>
            CEP
          </label>
          <Input
            id={`${idPrefix}-cep`}
            name="cep"
            inputMode="numeric"
            defaultValue={text("cep", patient?.cep)}
            maxLength={9}
            autoComplete="off"
            placeholder="00000-000"
          />
        </div>
        <div className={FIELD}>
          <label htmlFor={`${idPrefix}-street`} className={LABEL}>
            Logradouro
          </label>
          <Input id={`${idPrefix}-street`} name="street" defaultValue={text("street", patient?.street)} maxLength={120} autoComplete="off" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className={FIELD}>
            <label htmlFor={`${idPrefix}-number`} className={LABEL}>
              Número
            </label>
            <Input id={`${idPrefix}-number`} name="number" defaultValue={text("number", patient?.number)} maxLength={20} autoComplete="off" />
          </div>
          <div className={FIELD}>
            <label htmlFor={`${idPrefix}-complement`} className={LABEL}>
              Complemento
            </label>
            <Input id={`${idPrefix}-complement`} name="complement" defaultValue={text("complement", patient?.complement)} maxLength={60} autoComplete="off" />
          </div>
        </div>
        <div className={FIELD}>
          <label htmlFor={`${idPrefix}-district`} className={LABEL}>
            Bairro
          </label>
          <Input id={`${idPrefix}-district`} name="district" defaultValue={text("district", patient?.district)} maxLength={60} autoComplete="off" />
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <div className={FIELD}>
            <label htmlFor={`${idPrefix}-city`} className={LABEL}>
              Cidade
            </label>
            <Input id={`${idPrefix}-city`} name="city" defaultValue={text("city", patient?.city)} maxLength={60} autoComplete="off" />
          </div>
          <div className={FIELD}>
            <label htmlFor={`${idPrefix}-state`} className={LABEL}>
              UF
            </label>
            {/* `key`: o React só marca a opção padrão de um <select> ao MONTAR. */}
            <NativeSelect
              key={values?.state ?? "inicial"}
              id={`${idPrefix}-state`}
              name="state"
              defaultValue={text("state", patient?.state)}
            >
              <option value="">—</option>
              {UFS.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold">Convênio</legend>
        <div className={FIELD}>
          <label htmlFor={`${idPrefix}-insurance`} className={LABEL}>
            Convênio
          </label>
          <NativeSelect
            key={values?.insuranceId ?? "inicial"}
            id={`${idPrefix}-insurance`}
            name="insuranceId"
            defaultValue={text("insuranceId", patient?.insuranceId)}
            onChange={(event) => setInsuranceId(event.target.value)}
          >
            <option value="">Particular (sem convênio)</option>
            {insurances.map((insurance) => (
              <option key={insurance.id} value={insurance.id}>
                {insurance.name}
                {insurance.active ? "" : " (inativo)"}
              </option>
            ))}
          </NativeSelect>
        </div>
        {insuranceId !== "" ? (
          <div className={FIELD}>
            <label htmlFor={`${idPrefix}-card`} className={LABEL}>
              Número da carteirinha
            </label>
            <Input id={`${idPrefix}-card`} name="insuranceCard" defaultValue={text("insuranceCard", patient?.insuranceCard)} maxLength={40} autoComplete="off" />
          </div>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-2 text-sm font-semibold">Responsável legal</legend>
        <p className={HELP} data-testid="guardian-help">
          {minor
            ? "Paciente menor de 18 anos: informe nome, parentesco e telefone do responsável."
            : "Opcional para maiores de 18 anos."}
        </p>
        <div className={FIELD}>
          <label htmlFor={`${idPrefix}-guardian-name`} className={LABEL}>
            Nome do responsável
          </label>
          <Input id={`${idPrefix}-guardian-name`} name="guardianName" defaultValue={text("guardianName", patient?.guardianName)} maxLength={NAME_MAX} autoComplete="off" />
        </div>
        <div className={FIELD}>
          <label htmlFor={`${idPrefix}-guardian-relationship`} className={LABEL}>
            Parentesco
          </label>
          <Input id={`${idPrefix}-guardian-relationship`} name="guardianRelationship" defaultValue={text("guardianRelationship", patient?.guardianRelationship)} maxLength={40} autoComplete="off" placeholder="Mãe, pai, avó…" />
        </div>
        <div className={FIELD}>
          <label htmlFor={`${idPrefix}-guardian-phone`} className={LABEL}>
            Telefone do responsável
          </label>
          <Input id={`${idPrefix}-guardian-phone`} name="guardianPhone" type="tel" inputMode="tel" defaultValue={text("guardianPhone", patient?.guardianPhone ? formatPhone(patient.guardianPhone) : "")} autoComplete="off" placeholder="(11) 91234-5678" />
        </div>
        <div className={FIELD}>
          <label htmlFor={`${idPrefix}-guardian-cpf`} className={LABEL}>
            CPF do responsável
          </label>
          <Input id={`${idPrefix}-guardian-cpf`} name="guardianCpf" inputMode="numeric" defaultValue={text("guardianCpf", patient?.guardianCpf ? formatCpf(patient.guardianCpf) : "")} maxLength={14} autoComplete="off" placeholder="000.000.000-00" />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold">Profissionais que atendem</legend>
        <p className={HELP}>
          O profissional só vê os pacientes vinculados a ele. Você pode ajustar isto depois.
        </p>
        {professionals.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum profissional ativo cadastrado ainda.</p>
        ) : (
          <ul key={values?.professionalIds ?? "inicial"} className="flex flex-col gap-1">
            {professionals.map((professional) => (
              <li key={professional.id}>
                <label className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-sm">
                  <input
                    type="checkbox"
                    name="professionalIds"
                    value={professional.id}
                    defaultChecked={checked.has(professional.id)}
                    className="size-5 accent-brand"
                  />
                  <span>
                    {professional.fullName} · {specialtyLabel(professional.specialty)}
                    {professional.active ? "" : " (inativo)"}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className={FIELD}>
        <label htmlFor={`${idPrefix}-notes`} className={LABEL}>
          Observações administrativas
        </label>
        <textarea
          id={`${idPrefix}-notes`}
          name="adminNotes"
          defaultValue={text("adminNotes", patient?.adminNotes)}
          maxLength={ADMIN_NOTES_MAX}
          rows={3}
          className={TEXTAREA}
          aria-describedby={`${idPrefix}-notes-help`}
        />
        <p id={`${idPrefix}-notes-help`} className={HELP}>
          Visíveis só para a recepção e a administração. NÃO registre diagnóstico, queixas ou tratamento: isso é do
          prontuário (outra etapa).
        </p>
      </div>

      {/* Fixo no rodapé da rolagem: com o formulário longo o botão continua ao alcance no celular. */}
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
