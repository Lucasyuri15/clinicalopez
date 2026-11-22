import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/catalog/status-badge";
import { TimeOffForm } from "@/components/schedule/time-off-form";
import { WeekEditor } from "@/components/schedule/week-editor";
import { specialtyLabel } from "@/lib/catalog/labels";
import { describeTimeOff } from "@/lib/schedule/format";
import { isStaffRole } from "@/lib/appointments/status";
import { summarizeWeek } from "@/lib/schedule/week";
import { requirePageAccess } from "@/server/auth/session";
import { removeTimeOffAction } from "@/server/schedule/actions";
import { getScheduleOwner, getWeek, listTimeOff } from "@/server/schedule/queries";

export const metadata: Metadata = { title: "Horários" };

export default async function SchedulePage(props: PageProps<"/profissionais/[id]/horarios">) {
  const user = await requirePageAccess("/profissionais/[id]/horarios");
  const { id } = await props.params;
  const actor = { userId: user.userId };
  // Admin e recepção editam; o profissional só lê (a RLS e as ações repetem a regra).
  const canEdit = isStaffRole(user.role);
  const isProfessional = user.role === "professional";

  // `null` para id inexistente, removido ou que a RLS esconde (o profissional não abre o de um colega).
  const owner = await getScheduleOwner(actor, id);
  if (!owner) notFound();
  const [week, timeOff] = await Promise.all([getWeek(actor, id), listTimeOff(actor, id)]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <Link href="/profissionais" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← {isProfessional ? "Meu cadastro" : "Profissionais"}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold md:text-3xl">
            {isProfessional ? "Meus horários" : `Horários de ${owner.fullName}`}
          </h1>
          <StatusBadge active={owner.active} />
        </div>
        <p className="mt-1 text-muted-foreground">
          {specialtyLabel(owner.specialty)} · horários de atendimento por dia da semana, folgas e bloqueios.
        </p>
      </header>

      <section aria-labelledby="semana" className="flex flex-col gap-3">
        <h2 id="semana" className="text-lg font-semibold">
          Semana
        </h2>
        {canEdit ? (
          <WeekEditor professionalId={owner.id} initial={week} />
        ) : (
          <Card>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
                {summarizeWeek(week).map((day) => (
                  <div key={day.weekday} className="contents">
                    <dt className="font-medium">{day.label}</dt>
                    <dd className={day.text === "Sem atendimento" ? "text-muted-foreground" : undefined}>{day.text}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="folgas" className="flex flex-col gap-3">
        <h2 id="folgas" className="text-lg font-semibold">
          Folgas e bloqueios
        </h2>
        <p className="text-sm text-muted-foreground">
          Períodos em que não há atendimento, além da grade semanal. Aparecem os futuros e os dos últimos 30 dias.
        </p>
        {timeOff.length === 0 ? (
          <Card>
            <CardContent className="py-4 text-muted-foreground">Nenhuma folga ou bloqueio.</CardContent>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {timeOff.map((item) => (
              <li key={item.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium">{describeTimeOff(item.startsAt, item.endsAt)}</p>
                      {item.reason ? <p className="text-sm text-muted-foreground">{item.reason}</p> : null}
                    </div>
                    {canEdit ? (
                      <form action={removeTimeOffAction}>
                        <input type="hidden" name="id" value={item.id} />
                        <Button
                          type="submit"
                          variant="outline"
                          size="sm"
                          className="h-10 md:h-7"
                          aria-label={`Remover folga: ${describeTimeOff(item.startsAt, item.endsAt)}`}
                        >
                          Remover
                        </Button>
                      </form>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <Card>
            <CardContent>
              <h3 className="mb-3 font-medium">Adicionar folga ou bloqueio</h3>
              <TimeOffForm professionalId={owner.id} />
            </CardContent>
          </Card>
        ) : null}
      </section>
    </div>
  );
}
