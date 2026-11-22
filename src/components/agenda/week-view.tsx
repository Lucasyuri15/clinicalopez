import { groupByDate } from "@/lib/appointments/grouping";
import { shortDate } from "@/lib/appointments/headings";
import type { ActorRole } from "@/lib/appointments/status";
import { weekdayOf } from "@/lib/schedule/calendar";
import { weekdayLabel } from "@/lib/schedule/time";
import type { AgendaItem } from "@/server/appointments/queries";

import { AppointmentCard } from "./appointment-card";

type Props = {
  items: AgendaItem[];
  /** As 7 datas da semana, de segunda a domingo. */
  dates: string[];
  /** Hoje em Brasília: o dia de hoje fica destacado. */
  today: string;
  role: ActorRole;
};

/**
 * Visão de semana de UM profissional (o filtro já restringe): 7 colunas no desktop e os dias
 * empilhados no celular. Os dias sem atendimento aparecem (com aviso) para a semana ficar completa.
 */
export function WeekView({ items, dates, today, role }: Props) {
  const days = groupByDate(items, dates);

  return (
    <ol className="grid gap-3 md:grid-cols-7">
      {days.map((day) => {
        const isToday = day.date === today;
        const label = weekdayLabel(weekdayOf(day.date));
        return (
          <li
            key={day.date}
            aria-current={isToday ? "date" : undefined}
            className={`flex min-w-0 flex-col gap-2 rounded-lg border p-2 ${isToday ? "border-foreground bg-muted/40" : "border-border"}`}
          >
            <h3 className="text-sm font-semibold">
              {label} <span className="font-normal text-muted-foreground">{shortDate(day.date)}</span>
              {isToday ? <span className="ml-1 text-xs font-medium"> · Hoje</span> : null}
            </h3>
            {day.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem atendimentos</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {day.items.map((item) => (
                  <li key={item.id}>
                    <AppointmentCard item={item} role={role} compact />
                  </li>
                ))}
              </ol>
            )}
          </li>
        );
      })}
    </ol>
  );
}
