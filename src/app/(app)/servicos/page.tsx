import type { Metadata } from "next";

import { ActiveToggle } from "@/components/catalog/active-toggle";
import { PriceForm } from "@/components/catalog/price-form";
import { ServiceSheet } from "@/components/catalog/service-sheet";
import { StatusBadge } from "@/components/catalog/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { SPECIALTIES, specialtyLabel } from "@/lib/catalog/labels";
import { formatBRL } from "@/lib/money";
import { requirePageAccess } from "@/server/auth/session";
import { setServiceActiveAction } from "@/server/catalog/actions";
import { listParticularPrices, listServices } from "@/server/catalog/queries";

export const metadata: Metadata = { title: "Serviços" };

export default async function ServicosPage() {
  const user = await requirePageAccess("/servicos");
  const actor = { userId: user.userId };
  const canEdit = user.role === "admin";
  // O profissional vê o serviço, nunca o valor: nem a consulta de valores é feita para ele
  // (a RLS também devolveria vazio) e nada de valor entra na página.
  const canSeePrices = user.role !== "professional";

  const [services, prices] = await Promise.all([
    listServices(actor),
    canSeePrices ? listParticularPrices(actor) : Promise.resolve([]),
  ]);
  const priceByService = new Map(prices.map((price) => [price.serviceId, price]));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold md:text-3xl">Serviços</h1>
          <p className="mt-1 text-muted-foreground">
            {canSeePrices
              ? "Procedimentos, durações e valores particulares."
              : "Procedimentos e durações."}
          </p>
        </div>
        {canEdit ? <ServiceSheet /> : null}
      </header>

      {services.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-muted-foreground">
            Nenhum serviço cadastrado ainda.
            {canEdit ? " Use “Novo serviço” para começar." : ""}
          </CardContent>
        </Card>
      ) : null}

      {SPECIALTIES.map((specialty) => {
        const group = services.filter((service) => service.specialty === specialty);
        if (group.length === 0) return null;
        return (
          <section key={specialty} aria-labelledby={`grupo-${specialty}`} className="flex flex-col gap-3">
            <h2 id={`grupo-${specialty}`} className="text-lg font-semibold">
              {specialtyLabel(specialty)}
            </h2>
            <ul className="flex flex-col gap-3">
              {group.map((service) => {
                const price = priceByService.get(service.id) ?? null;
                return (
                  <li key={service.id}>
                    <Card className={service.active ? undefined : "opacity-80"}>
                      <CardContent className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium">{service.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {service.durationMinutes} min
                              {canSeePrices && !canEdit
                                ? ` · ${price ? formatBRL(price.priceCents) : "Sem valor cadastrado"}`
                                : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge active={service.active} />
                            {canEdit ? (
                              <>
                                <ServiceSheet service={service} />
                                <ActiveToggle
                                  action={setServiceActiveAction}
                                  id={service.id}
                                  active={service.active}
                                  name={service.name}
                                />
                              </>
                            ) : null}
                          </div>
                        </div>
                        {canEdit ? (
                          <PriceForm
                            serviceId={service.id}
                            serviceName={service.name}
                            insuranceId={null}
                            price={price ? { id: price.id, priceCents: price.priceCents } : null}
                          />
                        ) : null}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
