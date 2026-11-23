import type { Metadata } from "next";
import Link from "next/link";

import { RemoveFromWaitlistButton } from "@/components/waitlist/remove-button";
import { WaitlistSheet, type WaitlistOptions } from "@/components/waitlist/waitlist-sheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { SPECIALTIES, specialtyLabel } from "@/lib/catalog/labels";
import { formatDateBR } from "@/lib/datetime";
import { parseWaitlistFilters, waitlistHref } from "@/lib/waitlist/filters";
import { describePreference } from "@/lib/waitlist/match";
import { cn } from "@/lib/utils";
import { requirePageAccess } from "@/server/auth/session";
import { listServices } from "@/server/catalog/queries";
import { listProfessionals } from "@/server/professionals/queries";
import { listWaitlist, WAITLIST_LIMIT } from "@/server/waitlist/queries";

export const metadata: Metadata = { title: "Lista de espera" };

export default async function WaitlistPage(props: PageProps<"/lista-espera">) {
  const user = await requirePageAccess("/lista-espera");
  const actor = { userId: user.userId };
  const filters = parseWaitlistFilters(await props.searchParams);

  const [professionals, services] = await Promise.all([listProfessionals(actor), listServices(actor)]);
  // Um profissional que não existe (id da URL velho ou inventado) não filtra: o campo mostraria "Todos".
  const professionalFilter = professionals.some((professional) => professional.id === filters.professional) ? filters.professional : null;
  const items = await listWaitlist(actor, {
    view: filters.view,
    specialty: filters.specialty ?? undefined,
    professionalId: professionalFilter ?? undefined,
  });

  const activeServices = services.filter((service) => service.active);
  const serviceIds = new Set(activeServices.map((service) => service.id));
  const options: WaitlistOptions = {
    services: activeServices.map(({ id, name, specialty }) => ({ id, name, specialty })),
    professionals: professionals
      .filter((professional) => professional.active)
      .map((professional) => ({
        id: professional.id,
        fullName: professional.fullName,
        serviceIds: professional.serviceIds.filter((id) => serviceIds.has(id)),
      })),
  };
  const open = filters.view === "open";
  const tabClass = (active: boolean) => cn(buttonVariants({ variant: active ? "default" : "outline", size: "sm" }), "h-10 md:h-7");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold md:text-3xl">Lista de espera</h1>
          <p className="mt-1 text-muted-foreground">Quem aguarda uma vaga, por ordem de chegada.</p>
        </div>
        {options.services.length > 0 ? <WaitlistSheet options={options} /> : null}
      </header>

      <nav aria-label="Estado da espera" className="flex gap-2">
        <Link href={waitlistHref({ ...filters, view: "open" })} className={tabClass(open)} aria-current={open ? "page" : undefined}>
          Aguardando
        </Link>
        <Link href={waitlistHref({ ...filters, view: "closed" })} className={tabClass(!open)} aria-current={!open ? "page" : undefined}>
          Encerradas
        </Link>
      </nav>

      {/* Filtros por GET: só a especialidade e o profissional vão na URL (nunca dado de paciente). */}
      <form method="get" action="/lista-espera" className="flex flex-wrap items-end gap-3">
        {!open ? <input type="hidden" name="aba" value="encerradas" /> : null}
        <div className="flex min-w-40 flex-col gap-1.5">
          <label htmlFor="filter-specialty" className="text-sm font-medium">
            Especialidade
          </label>
          <NativeSelect id="filter-specialty" name="especialidade" defaultValue={filters.specialty ?? ""}>
            <option value="">Todas</option>
            {SPECIALTIES.map((specialty) => (
              <option key={specialty} value={specialty}>
                {specialtyLabel(specialty)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex min-w-48 flex-col gap-1.5">
          <label htmlFor="filter-professional" className="text-sm font-medium">
            Profissional
          </label>
          <NativeSelect id="filter-professional" name="profissional" defaultValue={professionalFilter ?? ""}>
            <option value="">Todos</option>
            {professionals.map((professional) => (
              <option key={professional.id} value={professional.id}>
                {professional.fullName}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="outline" className="h-11 md:h-8">
          Filtrar
        </Button>
      </form>

      {items.length >= WAITLIST_LIMIT ? (
        <p role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          Só os primeiros {WAITLIST_LIMIT} registros são mostrados. Use os filtros.
        </p>
      ) : null}

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-muted-foreground">
            {open ? "Ninguém na espera agora." : "Nenhuma espera encerrada."}
            {open && options.services.length === 0 ? " Cadastre um serviço ativo para poder usar a lista." : ""}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <Card>
                <CardContent className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Link href={`/pacientes/${item.patientId}`} className="font-medium underline-offset-4 hover:underline">
                      {item.patientName}
                    </Link>
                    <p className="text-sm">
                      {item.serviceName} · {specialtyLabel(item.specialty)}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.professionalName ?? "Qualquer profissional"} · {describePreference(item)}
                    </p>
                    {item.note ? <p className="text-sm text-muted-foreground">Obs.: {item.note}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      {open
                        ? `Na espera desde ${formatDateBR(item.createdAt)}`
                        : `${item.status === "fulfilled" ? "Atendida" : "Retirada"} em ${formatDateBR(item.closedAt ?? item.createdAt)}`}
                    </p>
                  </div>
                  {open ? (
                    <div className="flex flex-wrap items-start gap-2">
                      <WaitlistSheet
                        options={options}
                        entry={{
                          id: item.id,
                          patientName: item.patientName,
                          serviceId: item.serviceId,
                          serviceName: item.serviceName,
                          professionalId: item.professionalId,
                          professionalName: item.professionalName,
                          weekdays: item.weekdays,
                          startMinute: item.startMinute,
                          endMinute: item.endMinute,
                          note: item.note,
                        }}
                      />
                      <RemoveFromWaitlistButton id={item.id} patientName={item.patientName} />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
