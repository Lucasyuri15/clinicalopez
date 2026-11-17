import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PriceForm } from "@/components/catalog/price-form";
import { StatusBadge } from "@/components/catalog/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { specialtyLabel } from "@/lib/catalog/labels";
import { formatBRL } from "@/lib/money";
import { requirePageAccess } from "@/server/auth/session";
import { getInsurance, listInsurancePrices, listServices } from "@/server/catalog/queries";

export const metadata: Metadata = { title: "Valores do convênio" };

export default async function InsurancePricesPage(props: PageProps<"/convenios/[id]">) {
  const user = await requirePageAccess("/convenios/[id]");
  const { id } = await props.params;
  const actor = { userId: user.userId };
  const canEdit = user.role === "admin";

  const insurance = await getInsurance(actor, id);
  if (!insurance) notFound();

  const [services, prices] = await Promise.all([listServices(actor), listInsurancePrices(actor, id)]);
  const priceByService = new Map(prices.map((price) => [price.serviceId, price]));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <Link href="/convenios" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Convênios
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold md:text-3xl">{insurance.name}</h1>
          <StatusBadge active={insurance.active} />
        </div>
        <p className="mt-1 text-muted-foreground">Valor de cada serviço neste convênio.</p>
      </header>

      {services.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-muted-foreground">
            Cadastre serviços primeiro para definir os valores deste convênio.
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {services.map((service) => {
            const price = priceByService.get(service.id) ?? null;
            return (
              <li key={service.id}>
                <Card>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{service.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {specialtyLabel(service.specialty)} · {service.durationMinutes} min
                          {service.active ? "" : " · serviço inativo"}
                        </p>
                      </div>
                      {canEdit ? null : (
                        <p className="font-medium">
                          {price ? formatBRL(price.priceCents) : "Sem valor cadastrado"}
                        </p>
                      )}
                    </div>
                    {canEdit ? (
                      <PriceForm
                        serviceId={service.id}
                        serviceName={service.name}
                        insuranceId={insurance.id}
                        price={price ? { id: price.id, priceCents: price.priceCents } : null}
                      />
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
