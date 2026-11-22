"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { availableActions } from "@/lib/appointments/actions-available";
import { slotFormValues } from "@/lib/appointments/form-values";
import { statusActionLabel } from "@/lib/appointments/labels";
import { MAX_DURATION, MIN_DURATION, CANCEL_REASON_MAX } from "@/lib/appointments/schemas";
import { isStaffRole, type ActorRole } from "@/lib/appointments/status";
import { specialtyLabel } from "@/lib/catalog/labels";
import { formatDateBR, formatTimeBR, nowMs } from "@/lib/datetime";
import { STEP_MINUTES } from "@/lib/schedule/time";
import {
  cancelAppointmentAction,
  changeStatusAction,
  rescheduleAppointmentAction,
} from "@/server/appointments/actions";
import type { AgendaItem } from "@/server/appointments/queries";

import { AppointmentStatusBadge } from "./appointment-status-badge";
import { FormErrorBox, useFormAction } from "./form-action";

type Props = {
  item: AgendaItem;
  role: ActorRole;
  /** O conteúdo do botão que abre a gaveta (o cartão do atendimento). */
  children: ReactNode;
  triggerClassName: string;
  triggerLabel: string;
};

const FIELD = "flex flex-col gap-1.5";
const LABEL = "text-sm font-medium";
const HELP = "text-xs text-muted-foreground";
const TEXTAREA =
  "min-h-20 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-2 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";
const WIDE = "data-[side=right]:w-11/12 data-[side=right]:sm:max-w-md";

/** Detalhe do atendimento numa gaveta: situação, mudar status, remarcar e cancelar (conforme o papel). */
export function AppointmentSheet({ item, role, children, triggerClassName, triggerLabel }: Props) {
  const [open, setOpen] = useState(false);
  const patient = item.patientName ?? "Paciente";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<button type="button" className={triggerClassName} aria-label={triggerLabel} />}>
        {children}
      </SheetTrigger>
      <SheetContent className={WIDE}>
        <SheetHeader>
          <SheetTitle>{patient}</SheetTitle>
          <SheetDescription>
            {item.serviceName} · {formatDateBR(item.startsAt)}, {formatTimeBR(item.startsAt)} às{" "}
            {formatTimeBR(item.endsAt)}
          </SheetDescription>
        </SheetHeader>
        {/* O corpo mora DENTRO da gaveta: ao reabrir ele nasce na visão de detalhe, sem erro antigo. */}
        <AppointmentBody item={item} role={role} onDone={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

type Mode = "view" | "reschedule" | "cancel";

function AppointmentBody({ item, role, onDone }: { item: AgendaItem; role: ActorRole; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("view");
  // O corpo só existe com a gaveta aberta: o "agora" vale desde o momento em que ela abriu (e não
  // desde que a página carregou), então Realizada/Falta aparecem assim que o horário chega.
  const [now] = useState(nowMs);
  const actions = availableActions({ role, status: item.status, startsAt: item.startsAt, now: new Date(now) });
  const open = item.status === "scheduled" || item.status === "confirmed";

  if (mode === "reschedule") return <RescheduleForm item={item} onBack={() => setMode("view")} onSaved={onDone} />;
  if (mode === "cancel") return <CancelForm item={item} onBack={() => setMode("view")} onSaved={onDone} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Situação</dt>
        <dd>
          <AppointmentStatusBadge status={item.status} />
        </dd>
        <dt className="text-muted-foreground">Profissional</dt>
        <dd>
          {item.professionalName} · {specialtyLabel(item.specialty)}
        </dd>
        <dt className="text-muted-foreground">Serviço</dt>
        <dd>{item.serviceName}</dd>
        {item.status === "cancelled" && isStaffRole(role) && item.cancelReason ? (
          <>
            <dt className="text-muted-foreground">Motivo</dt>
            <dd className="break-words">{item.cancelReason}</dd>
          </>
        ) : null}
      </dl>

      {item.patientName !== null ? (
        <Link href={`/pacientes/${item.patientId}`} className="text-sm underline underline-offset-4">
          Ver cadastro do paciente
        </Link>
      ) : null}

      {actions.statuses.length > 0 ? <StatusForm item={item} statuses={actions.statuses} onSaved={onDone} /> : null}

      {role === "professional" && open && actions.statuses.length === 0 ? (
        <p className={HELP}>Realizada e Falta ficam disponíveis a partir do início do atendimento.</p>
      ) : null}

      {actions.canReschedule || actions.canCancel ? (
        <div className="flex flex-col gap-2">
          {actions.canReschedule ? (
            <Button type="button" variant="outline" className="h-11" onClick={() => setMode("reschedule")}>
              Remarcar
            </Button>
          ) : null}
          {actions.canCancel ? (
            <Button type="button" variant="destructive" className="h-11" onClick={() => setMode("cancel")}>
              Cancelar atendimento
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function StatusForm({
  item,
  statuses,
  onSaved,
}: {
  item: AgendaItem;
  statuses: ("confirmed" | "done" | "no_show")[];
  onSaved: () => void;
}) {
  const { state, formAction, pending, errorRef } = useFormAction(changeStatusAction, onSaved);
  // Só o botão clicado vira "Salvando…" (os outros continuam com o próprio texto, só desativados).
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <form action={formAction} className="flex flex-col gap-2" noValidate>
      <input type="hidden" name="id" value={item.id} />
      <FormErrorBox state={state} errorRef={errorRef} />
      {statuses.map((status) => (
        <Button
          key={status}
          type="submit"
          name="status"
          value={status}
          variant={status === "confirmed" ? "default" : "secondary"}
          className="h-11"
          disabled={pending}
          onClick={() => setChosen(status)}
        >
          {pending && chosen === status ? "Salvando…" : statusActionLabel(item.status, status)}
        </Button>
      ))}
    </form>
  );
}

function RescheduleForm({ item, onBack, onSaved }: { item: AgendaItem; onBack: () => void; onSaved: () => void }) {
  const { state, formAction, pending, errorRef } = useFormAction(rescheduleAppointmentAction, onSaved);
  const initial = slotFormValues(item);
  const values = state?.values;
  const text = (name: "date" | "startTime" | "durationMinutes") => values?.[name] ?? initial[name];
  // Chave de cada campo = o valor que o SERVIDOR devolveu (lição da 1B-3b): nunca um contador.
  const resetKey = (name: string) => values?.[name] ?? "inicial";
  const id = `reschedule-${item.id}`;

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4" noValidate>
      <input type="hidden" name="id" value={item.id} />
      <FormErrorBox state={state} errorRef={errorRef} />
      <p className={HELP}>
        O profissional e o serviço continuam os mesmos. Para trocar, cancele e crie outro atendimento. Uma
        confirmação volta para Agendada.
      </p>

      <div className={FIELD}>
        <label htmlFor={`${id}-date`} className={LABEL}>
          Nova data
        </label>
        <Input key={`date-${resetKey("date")}`} id={`${id}-date`} name="date" type="date" defaultValue={text("date")} />
      </div>
      <div className={FIELD}>
        <label htmlFor={`${id}-time`} className={LABEL}>
          Novo horário de início
        </label>
        <Input
          key={`time-${resetKey("startTime")}`}
          id={`${id}-time`}
          name="startTime"
          type="time"
          step={STEP_MINUTES * 60}
          defaultValue={text("startTime")}
        />
      </div>
      <div className={FIELD}>
        <label htmlFor={`${id}-duration`} className={LABEL}>
          Duração (minutos)
        </label>
        <Input
          key={`duration-${resetKey("durationMinutes")}`}
          id={`${id}-duration`}
          name="durationMinutes"
          type="number"
          inputMode="numeric"
          min={MIN_DURATION}
          max={MAX_DURATION}
          step={STEP_MINUTES}
          defaultValue={text("durationMinutes")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Button type="submit" className="h-11" disabled={pending}>
          {pending ? "Remarcando…" : "Remarcar"}
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={onBack} disabled={pending}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

function CancelForm({ item, onBack, onSaved }: { item: AgendaItem; onBack: () => void; onSaved: () => void }) {
  const { state, formAction, pending, errorRef } = useFormAction(cancelAppointmentAction, onSaved);
  const values = state?.values;
  const [length, setLength] = useState((values?.reason ?? "").length);
  const id = `cancel-${item.id}`;

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4" noValidate>
      <input type="hidden" name="id" value={item.id} />
      <FormErrorBox state={state} errorRef={errorRef} />
      <p className={HELP}>
        O horário volta a ficar livre. Um atendimento cancelado não pode ser reativado nem apagado.
      </p>
      <div className={FIELD}>
        <label htmlFor={`${id}-reason`} className={LABEL}>
          Motivo do cancelamento
        </label>
        <textarea
          key={`reason-${values?.reason ?? "inicial"}`}
          id={`${id}-reason`}
          name="reason"
          className={TEXTAREA}
          maxLength={CANCEL_REASON_MAX}
          defaultValue={values?.reason ?? ""}
          onChange={(event) => setLength(event.target.value.length)}
          aria-describedby={`${id}-help`}
        />
        <p id={`${id}-help`} className={HELP}>
          Não registre dado de saúde aqui. {length}/{CANCEL_REASON_MAX}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button type="submit" variant="destructive" className="h-11" disabled={pending}>
          {pending ? "Cancelando…" : "Confirmar cancelamento"}
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={onBack} disabled={pending}>
          Voltar
        </Button>
      </div>
    </form>
  );
}
