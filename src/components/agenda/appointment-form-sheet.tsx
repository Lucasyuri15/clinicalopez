"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { GridDay } from "@/lib/appointments/grid-hint";
import { MAX_DURATION, MIN_DURATION } from "@/lib/appointments/schemas";
import { specialtyLabel, type Specialty } from "@/lib/catalog/labels";
import { STEP_MINUTES } from "@/lib/schedule/time";
import { createAppointmentAction } from "@/server/appointments/actions";

import { FormErrorBox, useFormAction } from "./form-action";
import { PatientPicker } from "./patient-picker";

/** Um profissional ATIVO que pode receber agendamento, com o que o formulário precisa dele. */
export type BookableProfessional = {
  id: string;
  fullName: string;
  specialty: Specialty;
  /** Serviços ativos que ele realiza (a duração sugere o fim do atendimento). */
  services: { id: string; name: string; durationMinutes: number }[];
  /** Dias e faixas em que atende (só dica: quem recusa fora da grade é o servidor). */
  grid: GridDay[];
};

type Props = {
  professionals: BookableProfessional[];
  /** Data sugerida (a da visão, ou hoje se a visão for do passado), "AAAA-MM-DD". */
  defaultDate: string;
  /** Hoje em Brasília: é o mínimo do campo de data. */
  today: string;
  defaultProfessionalId: string | null;
};

const FIELD = "flex flex-col gap-1.5";
const LABEL = "text-sm font-medium";
const HELP = "text-xs text-muted-foreground";

/** Agendar um atendimento (admin e recepção), numa gaveta lateral. */
export function AppointmentFormSheet(props: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button className="h-11 md:h-8">
            <PlusIcon aria-hidden="true" />
            Agendar
          </Button>
        }
      />
      <SheetContent className="data-[side=right]:w-11/12 data-[side=right]:sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Agendar atendimento</SheetTitle>
          <SheetDescription>
            O horário precisa caber na grade do profissional e não pode ter folga nem outro atendimento.
          </SheetDescription>
        </SheetHeader>
        {/* Formulário DENTRO da gaveta: ao reabrir ele nasce limpo, sem erro nem texto antigo. */}
        <CreateForm {...props} onSaved={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function CreateForm({
  professionals,
  defaultDate,
  today,
  defaultProfessionalId,
  onSaved,
}: Props & { onSaved: () => void }) {
  const { state, formAction, pending, errorRef } = useFormAction(createAppointmentAction, onSaved);
  const values = state?.values;
  const resetKey = (name: string) => values?.[name] ?? "inicial";

  const validProfessional = (id: string | null | undefined) =>
    id && professionals.some((professional) => professional.id === id) ? id : "";
  // A escolha vive em estado só para filtrar os serviços e mostrar a grade; os campos continuam
  // não controlados (a chave de cada um é o valor que o SERVIDOR devolveu, lição da 1B-3b).
  const [professionalId, setProfessionalId] = useState(validProfessional(values?.professionalId ?? defaultProfessionalId));
  const professional = professionals.find((candidate) => candidate.id === professionalId);
  const [serviceId, setServiceId] = useState(values?.serviceId ?? "");
  const service = professional?.services.find((candidate) => candidate.id === serviceId);

  // A duração que a pessoa digitou volta depois de um erro enquanto o serviço for o MESMO do envio;
  // trocou o serviço, vale a duração dele. A chave inclui o valor devolvido pelo servidor: sem isso
  // o campo não remonta e o reset do formulário apaga o que foi digitado.
  const duration =
    values?.durationMinutes && values.serviceId === serviceId
      ? values.durationMinutes
      : String(service?.durationMinutes ?? "");

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4" noValidate>
      <FormErrorBox state={state} errorRef={errorRef} />

      <div className={FIELD}>
        <label htmlFor="appt-patient" className={LABEL}>
          Paciente
        </label>
        <PatientPicker id="appt-patient" />
      </div>

      <div className={FIELD}>
        <label htmlFor="appt-professional" className={LABEL}>
          Profissional
        </label>
        <NativeSelect
          key={`professional-${resetKey("professionalId")}`}
          id="appt-professional"
          name="professionalId"
          defaultValue={professionalId}
          onChange={(event) => {
            setProfessionalId(event.target.value);
            setServiceId("");
          }}
        >
          <option value="">Escolha…</option>
          {professionals.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.fullName} ({specialtyLabel(candidate.specialty)})
            </option>
          ))}
        </NativeSelect>
        {professional ? (
          <div className={HELP} data-testid="grid-hint">
            {professional.grid.length === 0 ? (
              <p>Este profissional ainda não tem horário de atendimento cadastrado.</p>
            ) : (
              <>
                <p>Atende:</p>
                <ul>
                  {professional.grid.map((day) => (
                    <li key={day.label}>
                      {day.label}: {day.text}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className={FIELD}>
        <label htmlFor="appt-service" className={LABEL}>
          Serviço
        </label>
        <NativeSelect
          key={`service-${professionalId}-${resetKey("serviceId")}`}
          id="appt-service"
          name="serviceId"
          defaultValue={professional?.services.some((s) => s.id === serviceId) ? serviceId : ""}
          disabled={!professional}
          onChange={(event) => setServiceId(event.target.value)}
        >
          <option value="">{professional ? "Escolha…" : "Escolha o profissional primeiro"}</option>
          {professional?.services.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name} ({candidate.durationMinutes} min)
            </option>
          ))}
        </NativeSelect>
        {professional && professional.services.length === 0 ? (
          <p className={HELP}>Este profissional não tem serviço ativo cadastrado.</p>
        ) : null}
      </div>

      <div className={FIELD}>
        <label htmlFor="appt-date" className={LABEL}>
          Data
        </label>
        <Input
          key={`date-${resetKey("date")}`}
          id="appt-date"
          name="date"
          type="date"
          min={today}
          defaultValue={values?.date ?? defaultDate}
        />
      </div>

      <div className={FIELD}>
        <label htmlFor="appt-time" className={LABEL}>
          Horário de início
        </label>
        <Input
          key={`time-${resetKey("startTime")}`}
          id="appt-time"
          name="startTime"
          type="time"
          step={STEP_MINUTES * 60}
          defaultValue={values?.startTime ?? ""}
        />
      </div>

      <div className={FIELD}>
        <label htmlFor="appt-duration" className={LABEL}>
          Duração (minutos)
        </label>
        <Input
          key={`duration-${serviceId}-${resetKey("durationMinutes")}`}
          id="appt-duration"
          name="durationMinutes"
          type="number"
          inputMode="numeric"
          min={MIN_DURATION}
          max={MAX_DURATION}
          step={STEP_MINUTES}
          defaultValue={duration}
          aria-describedby="appt-duration-help"
        />
        <p id="appt-duration-help" className={HELP}>
          Sugerida pela duração do serviço; pode ser ajustada para este atendimento.
        </p>
      </div>

      <Button type="submit" className="h-11" disabled={pending}>
        {pending ? "Agendando…" : "Agendar"}
      </Button>
    </form>
  );
}
