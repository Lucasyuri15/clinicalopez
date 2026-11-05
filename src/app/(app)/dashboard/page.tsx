import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageAccess } from "@/server/auth/session";

export const metadata: Metadata = { title: "Dashboard" };

const INDICATORS = [
  "Atendimentos de hoje",
  "Taxa de faltas",
  "Novos pacientes",
  "A receber",
] as const;

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  await requirePageAccess("/dashboard");
  const { acesso } = await props.searchParams;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      {acesso === "negado" ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-accent px-3 py-2 text-sm text-accent-foreground"
        >
          Você não tem acesso a essa área. Se precisar dela, fale com o
          administrador.
        </p>
      ) : null}
      <header>
        <h1 className="text-2xl font-semibold md:text-3xl">Dashboard</h1>
        <p className="mt-1 text-muted-foreground">
          Visão geral da operação da clínica.
        </p>
      </header>

      <section
        aria-label="Indicadores"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {INDICATORS.map((label) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-heading text-3xl font-semibold">—</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Sem dados ainda
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
