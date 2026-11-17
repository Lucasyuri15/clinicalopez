import type { Metadata } from "next";
import Link from "next/link";

import { ActiveToggle } from "@/components/catalog/active-toggle";
import { InsuranceSheet } from "@/components/catalog/insurance-sheet";
import { StatusBadge } from "@/components/catalog/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { requirePageAccess } from "@/server/auth/session";
import { setInsuranceActiveAction } from "@/server/catalog/actions";
import { listInsurances } from "@/server/catalog/queries";

export const metadata: Metadata = { title: "Convênios" };

export default async function ConveniosPage() {
  const user = await requirePageAccess("/convenios");
  const canEdit = user.role === "admin";
  const insurances = await listInsurances({ userId: user.userId });

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold md:text-3xl">Convênios</h1>
          <p className="mt-1 text-muted-foreground">Planos atendidos e valores por serviço.</p>
        </div>
        {canEdit ? <InsuranceSheet /> : null}
      </header>

      {insurances.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-muted-foreground">
            Nenhum convênio cadastrado ainda.
            {canEdit ? " Use “Novo convênio” quando tiver os dados do plano." : ""}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {insurances.map((insurance) => (
            <li key={insurance.id}>
              <Card className={insurance.active ? undefined : "opacity-80"}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="font-medium">{insurance.name}</p>
                    <StatusBadge active={insurance.active} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/convenios/${insurance.id}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 md:h-7")}
                      aria-label={`Ver valores de ${insurance.name}`}
                    >
                      Valores
                    </Link>
                    {canEdit ? (
                      <>
                        <InsuranceSheet insurance={insurance} />
                        <ActiveToggle
                          action={setInsuranceActiveAction}
                          id={insurance.id}
                          active={insurance.active}
                          name={insurance.name}
                        />
                      </>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
