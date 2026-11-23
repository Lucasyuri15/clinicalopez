"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { FormErrorBox, useFormAction } from "@/components/agenda/form-action";
import { PatientPicker } from "@/components/agenda/patient-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { specialtyLabel, type Specialty } from "@/lib/catalog/labels";
import { STEP_MINUTES, WEEKDAY_ORDER, weekdayLabel } from "@/lib/schedule/time";
import { timeInputValue } from "@/lib/waitlist/match";
import { NOTE_MAX } from "@/lib/waitlist/schemas";
import { addWaitlistAction, updateWaitlistAction } from "@/server/waitlist/actions";

/** O que o formulário precisa para escolher serviço e profissional (só ativos). */
export type WaitlistOptions = {
  services: { id: string; name: string; specialty: Specialty }[];
  /** Profissionais ativos e os serviços (ativos) que cada um realiza. */
  professionals: { id: string; fullName: string; serviceIds: string[] }[];
};

/** Uma espera aberta, como a tela a mostra, para editar. */
export type EditableEntry = {
  id: string;
  patientName: string;
  serviceId: string;
  serviceName: string;
  professionalId: string | null;
  /** O nome do profissional pedido (para mostrá-lo mesmo se ele já não estiver entre as opções). */
  professionalName: string | null;
  weekdays: number[];
  startMinute: number | null;
  endMinute: number | null;
  note: string | null;
};

const FIELD = "flex flex-col gap-1.5";
const LABEL = "text-sm font-medium";
const HELP = "text-xs text-muted-foreground";

/**
 * Pôr alguém na espera, ou editar a preferência de quem já está (admin e recepção), numa gaveta
 * lateral. Paciente e serviço só se escolhem ao pôr; para mudá-los, tira-se e põe-se de novo.
 */
export function WaitlistSheet({ options, entry }: { options: WaitlistOptions; entry?: EditableEntry }) {
  const [open, setOpen] = useState(false);
  const editing = entry !== undefined;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          editing ? (
            <Button variant="outline" size="sm" className="h-10 md:h-7" aria-label={`Editar a espera de ${entry.patientName}`}>
              Editar
            </Button>
          ) : (
            <Button className="h-11 md:h-8">
              <PlusIcon aria-hidden="true" />
              Pôr na espera
            </Button>
          )
        }
      />
      <SheetContent className="data-[side=right]:w-11/12 data-[side=right]:sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editing ? "Editar a espera" : "Pôr na espera"}</SheetTitle>
          <SheetDescription>
            Registre quem aguarda vaga e o que prefere: profissional, dias e horários.
          </SheetDescription>
        </SheetHeader>
        {/* Formulário DENTRO da gaveta: ao reabrir ele nasce limpo, sem erro nem texto antigo. */}
        <WaitlistForm options={options} entry={entry} onSaved={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function WaitlistForm({ options, entry, onSaved }: { options: WaitlistOptions; entry?: EditableEntry; onSaved: () => void }) {
  const editing = entry !== undefined;
  const { state, formAction, pending, errorRef } = useFormAction(editing ? updateWaitlistAction : addWaitlistAction, onSaved);
  const values = state?.values;
  // Cada campo remonta com o valor que o SERVIDOR devolveu (o reset do formulário apaga o digitado).
  const resetKey = (name: string) => values?.[name] ?? "inicial";

  const [serviceId, setServiceId] = useState(entry?.serviceId ?? values?.serviceId ?? "");
  const offering = options.professionals.filter((professional) => professional.serviceIds.includes(serviceId));
  // A escolha do profissional vive em estado: trocar o serviço remonta o campo, e sem isto ele voltaria ao
  // valor devolvido por um erro antigo. Ao trocar o serviço, volta a "Qualquer profissional".
  const [professionalId, setProfessionalId] = useState(values?.professionalId ?? entry?.professionalId ?? "");
  // Ao editar, o profissional JÁ pedido continua como opção mesmo que tenha sido desativado ou deixado de
  // realizar o serviço: sem isto o campo mostraria "Qualquer" e salvar o trocaria sem aviso.
  const keptCurrent =
    entry?.professionalId && !offering.some((professional) => professional.id === entry.professionalId) ? entry : null;

  const checkedDays = values
    ? values.weekdays?.split(",").filter(Boolean).map(Number)
    : (entry?.weekdays ?? []);

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4" noValidate>
      <FormErrorBox state={state} errorRef={errorRef} />

      {editing ? (
        <>
          <input type="hidden" name="id" value={entry.id} />
          <div className={FIELD}>
            <p className={LABEL}>Paciente</p>
            <p>{entry.patientName}</p>
          </div>
          <div className={FIELD}>
            <p className={LABEL}>Serviço</p>
            <p>{entry.serviceName}</p>
          </div>
        </>
      ) : (
        <>
          <div className={FIELD}>
            <label htmlFor="wait-patient" className={LABEL}>
              Paciente
            </label>
            <PatientPicker id="wait-patient" />
          </div>
          <div className={FIELD}>
            <label htmlFor="wait-service" className={LABEL}>
              Serviço
            </label>
            <NativeSelect
              key={`service-${resetKey("serviceId")}`}
              id="wait-service"
              name="serviceId"
              defaultValue={serviceId}
              onChange={(event) => {
                setServiceId(event.target.value);
                setProfessionalId("");
              }}
            >
              <option value="">Escolha…</option>
              {options.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name} ({specialtyLabel(service.specialty)})
                </option>
              ))}
            </NativeSelect>
          </div>
        </>
      )}

      <div className={FIELD}>
        <label htmlFor="wait-professional" className={LABEL}>
          Profissional
        </label>
        <NativeSelect
          key={`professional-${serviceId}`}
          id="wait-professional"
          name="professionalId"
          defaultValue={professionalId}
          disabled={serviceId === ""}
          onChange={(event) => setProfessionalId(event.target.value)}
        >
          <option value="">{serviceId === "" ? "Escolha o serviço primeiro" : "Qualquer profissional"}</option>
          {keptCurrent ? (
            <option value={keptCurrent.professionalId ?? ""}>{keptCurrent.professionalName ?? "Profissional atual"} (já pedido)</option>
          ) : null}
          {offering.map((professional) => (
            <option key={professional.id} value={professional.id}>
              {professional.fullName}
            </option>
          ))}
        </NativeSelect>
        {serviceId !== "" && offering.length === 0 ? <p className={HELP}>Nenhum profissional ativo realiza este serviço.</p> : null}
      </div>

      <fieldset className={FIELD}>
        <legend className={LABEL}>Dias da semana</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {WEEKDAY_ORDER.map((day) => (
            <label key={`${day}-${resetKey("weekdays")}`} className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
              <input type="checkbox" name="weekdays" value={day} defaultChecked={checkedDays?.includes(day)} className="size-4" />
              {weekdayLabel(day).replace("-feira", "")}
            </label>
          ))}
        </div>
        <p className={HELP}>Sem nenhum dia marcado, qualquer dia serve.</p>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <div className={FIELD}>
          <label htmlFor="wait-start" className={LABEL}>
            A partir das
          </label>
          <Input
            key={`start-${resetKey("startTime")}`}
            id="wait-start"
            name="startTime"
            type="time"
            step={STEP_MINUTES * 60}
            defaultValue={values?.startTime ?? timeInputValue(entry?.startMinute)}
          />
        </div>
        <div className={FIELD}>
          <label htmlFor="wait-end" className={LABEL}>
            Até as
          </label>
          <Input
            key={`end-${resetKey("endTime")}`}
            id="wait-end"
            name="endTime"
            type="time"
            step={STEP_MINUTES * 60}
            defaultValue={values?.endTime ?? timeInputValue(entry?.endMinute)}
          />
        </div>
        <p className={`${HELP} col-span-2`}>O atendimento inteiro precisa caber na faixa. “00:00” no fim significa a meia-noite. Em branco, qualquer horário serve.</p>
      </div>

      <div className={FIELD}>
        <label htmlFor="wait-note" className={LABEL}>
          Observação (opcional)
        </label>
        <Input
          key={`note-${resetKey("note")}`}
          id="wait-note"
          name="note"
          maxLength={NOTE_MAX}
          defaultValue={values?.note ?? entry?.note ?? ""}
          aria-describedby="wait-note-help"
        />
        <p id="wait-note-help" className={HELP}>
          Só o que ajuda a encaixar (ex.: “só depois do trabalho”). Não registre dado de saúde.
        </p>
      </div>

      <Button type="submit" className="h-11" disabled={pending}>
        {pending ? "Salvando…" : editing ? "Salvar" : "Pôr na espera"}
      </Button>
    </form>
  );
}
