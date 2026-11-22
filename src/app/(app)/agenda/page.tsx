import type { Metadata } from "next";

import { AgendaToolbar } from "@/components/agenda/agenda-toolbar";
import { AppointmentFormSheet, type BookableProfessional } from "@/components/agenda/appointment-form-sheet";
import { DayView } from "@/components/agenda/day-view";
import { WeekView } from "@/components/agenda/week-view";
import { gridDays } from "@/lib/appointments/grid-hint";
import { dayHeading, weekHeading } from "@/lib/appointments/headings";
import { parseAgendaFilters } from "@/lib/appointments/schemas";
import { isStaffRole } from "@/lib/appointments/status";
import { todayBR } from "@/lib/datetime";
import { dayWindow, weekDates, weekWindow } from "@/lib/schedule/calendar";
import { AGENDA_LIMIT, listAppointments } from "@/server/appointments/queries";
import { requirePageAccess } from "@/server/auth/session";
import { listServices } from "@/server/catalog/queries";
import { listProfessionals } from "@/server/professionals/queries";
import { getWeek } from "@/server/schedule/queries";

export const metadata: Metadata = { title: "Agenda" };

export default async function AgendaPage(props: PageProps<"/agenda">) {
  const user = await requirePageAccess("/agenda");
  const actor = { userId: user.userId };
  const staff = isStaffRole(user.role);
  const today = todayBR();
  const parsed = parseAgendaFilters(await props.searchParams, today);

  // Profissionais e serviços só para a equipe (filtro e formulário de agendar). O profissional só
  // enxerga os próprios atendimentos pela RLS, e nem recebe o filtro.
  const [professionals, services] = staff ? await Promise.all([listProfessionals(actor), listServices(actor)]) : [[], []];
  const active = professionals.filter((professional) => professional.active);

  // Profissional efetivo: ignorado para o papel profissional; some se não existe ou se não é da
  // especialidade filtrada; na semana (um profissional por vez) cai no primeiro da lista.
  let professionalId = staff ? parsed.professional : null;
  const chosen = professionals.find((professional) => professional.id === professionalId);
  if (!chosen || (parsed.specialty && chosen.specialty !== parsed.specialty)) professionalId = null;
  if (staff && parsed.view === "week" && professionalId === null) {
    professionalId = active.find((professional) => !parsed.specialty || professional.specialty === parsed.specialty)?.id ?? null;
  }
  const filters = { ...parsed, professional: professionalId };

  const window = filters.view === "week" ? weekWindow(filters.date) : dayWindow(filters.date);
  const weekWithoutProfessional = staff && filters.view === "week" && professionalId === null;
  const items = weekWithoutProfessional
    ? []
    : await listAppointments(actor, {
        from: window.from,
        to: window.to,
        professionalId,
        specialty: filters.specialty,
        role: user.role,
      });

  let bookable: BookableProfessional[] = [];
  if (staff) {
    const serviceById = new Map(services.filter((service) => service.active).map((service) => [service.id, service]));
    const weeks = await Promise.all(active.map((professional) => getWeek(actor, professional.id)));
    bookable = active.map((professional, index) => ({
      id: professional.id,
      fullName: professional.fullName,
      specialty: professional.specialty,
      services: professional.serviceIds.flatMap((id) => {
        const service = serviceById.get(id);
        return service ? [{ id: service.id, name: service.name, durationMinutes: service.durationMinutes }] : [];
      }),
      grid: gridDays(weeks[index] ?? []),
    }));
  }

  const heading = filters.view === "week" ? weekHeading(filters.date) : dayHeading(filters.date);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold md:text-3xl">Agenda</h1>
        <p className="text-sm text-muted-foreground">
          {staff ? "Atendimentos por dia ou por semana, com filtro por profissional e especialidade." : "Seus atendimentos por dia ou por semana."}
        </p>
      </header>

      <AgendaToolbar
        filters={filters}
        today={today}
        heading={heading}
        professionals={
          staff
            ? professionals.map(({ id, fullName, specialty, active: isActive }) => ({ id, fullName, specialty, active: isActive }))
            : null
        }
      >
        {staff && bookable.length === 0 ? (
          <p className="text-xs text-muted-foreground">Cadastre um profissional ativo para poder agendar.</p>
        ) : null}
        {staff && bookable.length > 0 ? (
          <AppointmentFormSheet
            professionals={bookable}
            today={today}
            defaultDate={filters.date < today ? today : filters.date}
            defaultProfessionalId={professionalId}
          />
        ) : null}
      </AgendaToolbar>

      {items.length >= AGENDA_LIMIT ? (
        <p role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          Há muitos atendimentos neste período e só os primeiros {AGENDA_LIMIT} são mostrados. Filtre por profissional
          ou escolha um período menor.
        </p>
      ) : null}

      {weekWithoutProfessional ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhum profissional ativo para esta especialidade.
        </p>
      ) : filters.view === "week" ? (
        <WeekView items={items} dates={weekDates(filters.date)} today={today} role={user.role} />
      ) : (
        <DayView items={items} role={user.role} />
      )}
    </div>
  );
}
