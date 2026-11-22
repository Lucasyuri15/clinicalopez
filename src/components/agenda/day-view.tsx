import type { ActorRole } from "@/lib/appointments/status";
import { groupByProfessional } from "@/lib/appointments/grouping";
import { specialtyLabel } from "@/lib/catalog/labels";
import type { AgendaItem } from "@/server/appointments/queries";

import { AppointmentCard } from "./appointment-card";

type Props = {
  items: AgendaItem[];
  role: ActorRole;
};

/** Visão de dia: uma seção por profissional, cada uma com os atendimentos por horário. */
export function DayView({ items, role }: Props) {
  const groups = groupByProfessional(items);

  if (groups.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Nenhum atendimento neste dia.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.professionalId} aria-labelledby={`prof-${group.professionalId}`} className="flex flex-col gap-2">
          <h3 id={`prof-${group.professionalId}`} className="text-base font-semibold">
            {group.professionalName}{" "}
            <span className="text-sm font-normal text-muted-foreground">· {specialtyLabel(group.specialty)}</span>
          </h3>
          <ol className="flex flex-col gap-2">
            {group.items.map((item) => (
              <li key={item.id}>
                <AppointmentCard item={item} role={role} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
