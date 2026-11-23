"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { availableActions } from "@/lib/appointments/actions-available";
import { slotFormValues } from "@/lib/appointments/form-values";
import { occurrenceReasonLabel, statusActionLabel } from "@/lib/appointments/labels";
import { MAX_DURATION, MIN_DURATION, CANCEL_REASON_MAX } from "@/lib/appointments/schemas";
import { formatSeriesSlot, seriesProgressText, unmovedSummaryText } from "@/lib/appointments/series-format";
import { isStaffRole, type ActorRole } from "@/lib/appointments/status";
import { specialtyLabel } from "@/lib/catalog/labels";
import { addDaysToDate, formatDateBR, formatTimeBR, nowMs } from "@/lib/datetime";
import { weekdayOf } from "@/lib/schedule/calendar";
import { STEP_MINUTES } from "@/lib/schedule/time";
import {
  cancelAppointmentAction,
  changeStatusAction,
  rescheduleAppointmentAction,
  type CancelFormState,
} from "@/server/appointments/actions";
import type { AgendaItem } from "@/server/appointments/queries";
import {
  cancelSeriesFromAction,
  previewRenewalAction,
  renewSeriesAction,
  rescheduleSeriesFromAction,
  type SeriesFormState,
} from "@/server/appointments/series-actions";

import { AppointmentStatusBadge } from "./appointment-status-badge";
import { FormErrorBox, useFormAction } from "./form-action";
import { hasSkippedSummary, SeriesSection, SkippedSummary, SummaryPanel, useStalePreview } from "./series-section";
import { WaitlistSuggestion } from "./waitlist-suggestion";

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

type Mode = "view" | "reschedule" | "cancel" | "renew";

function AppointmentBody({ item, role, onDone }: { item: AgendaItem; role: ActorRole; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("view");
  // O corpo só existe com a gaveta aberta: o "agora" vale desde o momento em que ela abriu (e não
  // desde que a página carregou), então Realizada/Falta aparecem assim que o horário chega.
  const [now] = useState(nowMs);
  const actions = availableActions({ role, status: item.status, startsAt: item.startsAt, now: new Date(now) });
  const open = item.status === "scheduled" || item.status === "confirmed";
  // Só a equipe vê qualquer coisa de série. O servidor já não manda `item.series` ao profissional; conferir o
  // papel aqui também impede que um `AgendaItem` montado por outro caminho exponha algo por engano.
  const series = isStaffRole(role) ? (item.series ?? null) : null;

  if (mode === "reschedule") return <RescheduleForm item={item} inSeries={series !== null} onBack={() => setMode("view")} onSaved={onDone} />;
  if (mode === "cancel") return <CancelForm item={item} inSeries={series !== null} onBack={() => setMode("view")} onSaved={onDone} />;
  if (mode === "renew" && series) return <RenewForm item={item} seriesId={series.id} onBack={() => setMode("view")} onSaved={onDone} />;

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
        {series ? (
          <>
            <dt className="text-muted-foreground">Série</dt>
            <dd>{seriesProgressText(series)}</dd>
          </>
        ) : null}
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

      {series ? (
        <Button type="button" variant="outline" className="h-11" onClick={() => setMode("renew")}>
          Renovar série
        </Button>
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

type Scope = "one" | "forward";

/** "Só esta sessão" ou "esta e as seguintes", só para sessões de uma série (a equipe). O valor vai num campo oculto. */
function ScopeChoice({ scope, onChange, idPrefix }: { scope: Scope; onChange: (scope: Scope) => void; idPrefix: string }) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-medium">Aplicar a</legend>
      <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
        <input
          type="radio"
          name={`${idPrefix}-scopeChoice`}
          id={`${idPrefix}-scope-one`}
          checked={scope === "one"}
          onChange={() => onChange("one")}
          className="size-4"
        />
        Só esta sessão
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm md:min-h-8">
        <input
          type="radio"
          name={`${idPrefix}-scopeChoice`}
          id={`${idPrefix}-scope-forward`}
          checked={scope === "forward"}
          onChange={() => onChange("forward")}
          className="size-4"
        />
        Esta e as seguintes da série
      </label>
    </fieldset>
  );
}

function RescheduleForm({ item, inSeries, onBack, onSaved }: { item: AgendaItem; inSeries: boolean; onBack: () => void; onSaved: () => void }) {
  const [scope, setScope] = useState<Scope>("one");
  // Uma ação só para a gaveta: escopo "esta e as seguintes" vai para a ação da série (o campo oculto manda).
  const { state, formAction, pending, errorRef } = useFormAction<SeriesFormState>(
    async (previous, formData) =>
      formData.get("scope") === "forward"
        ? rescheduleSeriesFromAction(previous, formData)
        : rescheduleAppointmentAction(previous, formData),
    onSaved,
    // Com sessões que não couberam, a gaveta fica aberta para mostrar quais foram.
    (result) => Boolean(result.unmoved?.length),
  );
  const initial = slotFormValues(item);
  const values = state?.values;
  const text = (name: "date" | "startTime" | "durationMinutes") => values?.[name] ?? initial[name];
  // Chave de cada campo = o valor que o SERVIDOR devolveu (lição da 1B-3b): nunca um contador.
  const resetKey = (name: string) => values?.[name] ?? "inicial";
  const id = `reschedule-${item.id}`;

  if (state?.success && state.unmoved?.length) {
    return (
      <SummaryPanel intro={unmovedSummaryText(state.moved ?? 0, state.unmoved.length)} onClose={onSaved}>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border text-sm">
          {state.unmoved.map((row) => (
            <li key={row.from} className="p-2">
              <span className="block">
                {formatSeriesSlot(row.from)}
                <span className="text-muted-foreground"> (não coube em {formatDateBR(row.to)}, {formatTimeBR(row.to)})</span>
              </span>
              <span className="block text-xs font-medium text-destructive">{occurrenceReasonLabel(row.reason)}</span>
            </li>
          ))}
        </ul>
      </SummaryPanel>
    );
  }

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4" noValidate>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="scope" value={inSeries ? scope : "one"} />
      <FormErrorBox state={state} errorRef={errorRef} />
      <p className={HELP}>
        O profissional e o serviço continuam os mesmos. Para trocar, cancele e crie outro atendimento. Uma
        confirmação volta para Agendada.
      </p>
      {inSeries ? <ScopeChoice scope={scope} onChange={setScope} idPrefix={id} /> : null}
      {inSeries && scope === "forward" ? (
        <p className={HELP}>
          As seguintes que ainda estão abertas andam o mesmo número de dias e passam para o novo horário. As que não
          couberem ficam como estão, e você verá a lista.
        </p>
      ) : null}

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
          {pending ? "Remarcando…" : scope === "forward" && inSeries ? "Remarcar esta e as seguintes" : "Remarcar"}
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={onBack} disabled={pending}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** O estado do formulário de cancelar: o da série ou o do atendimento avulso (com a sugestão da espera). */
type CancelState = NonNullable<SeriesFormState> & NonNullable<CancelFormState>;

function CancelForm({ item, inSeries, onBack, onSaved }: { item: AgendaItem; inSeries: boolean; onBack: () => void; onSaved: () => void }) {
  const [scope, setScope] = useState<Scope>("one");
  // Cancelar só ESTA sessão pode trazer uma sugestão da lista de espera (a série "daqui para frente" não).
  const { state, formAction, pending, errorRef } = useFormAction<CancelState | undefined>(
    async (previous, formData) =>
      formData.get("scope") === "forward"
        ? cancelSeriesFromAction(previous, formData)
        : cancelAppointmentAction(previous, formData),
    onSaved,
    // Com candidatos na espera, a gaveta fica aberta para a recepção agendar um deles.
    (result) => Boolean(result.suggestion),
  );
  const values = state?.values;
  const [length, setLength] = useState((values?.reason ?? "").length);
  const id = `cancel-${item.id}`;
  const forward = inSeries && scope === "forward";

  if (state?.success && state.suggestion) return <WaitlistSuggestion suggestion={state.suggestion} onClose={onSaved} />;

  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4" noValidate>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="scope" value={inSeries ? scope : "one"} />
      <FormErrorBox state={state} errorRef={errorRef} />
      {inSeries ? <ScopeChoice scope={scope} onChange={setScope} idPrefix={id} /> : null}
      <p className={HELP}>
        {forward
          ? "Cancela esta e todas as seguintes que ainda estão abertas; as já realizadas ou com falta ficam. Os horários voltam a ficar livres. Um atendimento cancelado não pode ser reativado nem apagado."
          : "O horário volta a ficar livre. Um atendimento cancelado não pode ser reativado nem apagado."}
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
          {pending ? "Cancelando…" : forward ? "Cancelar esta e as seguintes" : "Confirmar cancelamento"}
        </Button>
        <Button type="button" variant="outline" className="h-11" onClick={onBack} disabled={pending}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** Renovar: mais sessões na MESMA série (o servidor confere profissional e serviço), com prévia. */
function RenewForm({ item, seriesId, onBack, onSaved }: { item: AgendaItem; seriesId: string; onBack: () => void; onSaved: () => void }) {
  const { state, formAction, pending, errorRef } = useFormAction<SeriesFormState>(
    async (previous, formData) =>
      formData.get("intent") === "create" ? renewSeriesAction(previous, formData) : previewRenewalAction(previous, formData),
    onSaved,
    (result) => Boolean(result.skipped?.length),
  );
  const { stale, onEdit } = useStalePreview(state);
  const initial = slotFormValues(item);
  const values = state?.values;
  const resetKey = (name: string) => values?.[name] ?? "inicial";
  // Sugestão: uma semana depois desta sessão. A prévia mostra qualquer choque com as sessões que já existem.
  const defaultDate = addDaysToDate(initial.date, 7);
  const id = `renew-${item.id}`;

  if (hasSkippedSummary(state) && state?.skipped) {
    return <SkippedSummary created={state.created ?? 0} skipped={state.skipped} onClose={onSaved} />;
  }

  return (
    <form action={formAction} onChange={onEdit} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4" noValidate>
      <fieldset disabled={pending} className="contents">
      <input type="hidden" name="seriesId" value={seriesId} />
      <FormErrorBox state={state} errorRef={errorRef} />
      <p className={HELP}>
        Cria mais sessões na mesma série, com o mesmo profissional, paciente e serviço. Veja a prévia antes de criar.
      </p>

      <div className={FIELD}>
        <label htmlFor={`${id}-date`} className={LABEL}>
          Data da primeira nova sessão
        </label>
        <Input key={`date-${resetKey("date")}`} id={`${id}-date`} name="date" type="date" defaultValue={values?.date ?? defaultDate} />
      </div>
      <div className={FIELD}>
        <label htmlFor={`${id}-time`} className={LABEL}>
          Horário de início
        </label>
        <Input
          key={`time-${resetKey("startTime")}`}
          id={`${id}-time`}
          name="startTime"
          type="time"
          step={STEP_MINUTES * 60}
          defaultValue={values?.startTime ?? initial.startTime}
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
          defaultValue={values?.durationMinutes ?? initial.durationMinutes}
        />
      </div>

      <SeriesSection
        defaultWeekday={weekdayOf(defaultDate)}
        idPrefix={id}
        values={values}
        resetKey={resetKey}
        state={state}
        stale={stale}
        pending={pending}
      />

      <Button type="button" variant="outline" className="h-11" onClick={onBack} disabled={pending}>
        Voltar
      </Button>
      </fieldset>
    </form>
  );
}
