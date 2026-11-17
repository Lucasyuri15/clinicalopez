import type { Metadata } from "next";

import { ActiveToggle } from "@/components/catalog/active-toggle";
import { StatusBadge } from "@/components/catalog/status-badge";
import { ProfessionalSheet } from "@/components/professionals/professional-sheet";
import { Card, CardContent } from "@/components/ui/card";
import { specialtyLabel } from "@/lib/catalog/labels";
import { formatPhone } from "@/lib/phone";
import { formatRegistration } from "@/lib/professionals/labels";
import { requirePageAccess } from "@/server/auth/session";
import { listServices } from "@/server/catalog/queries";
import { setProfessionalActiveAction } from "@/server/professionals/actions";
import { listLinkableProfiles, listProfessionals } from "@/server/professionals/queries";

export const metadata: Metadata = { title: "Profissionais" };

export default async function ProfissionaisPage() {
  const user = await requirePageAccess("/profissionais");
  const actor = { userId: user.userId };
  const canEdit = user.role === "admin";
  // O profissional enxerga SÓ o próprio cadastro: quem decide é a RLS (1 linha), não esta tela.
  const isProfessional = user.role === "professional";

  const [professionals, services] = await Promise.all([listProfessionals(actor), listServices(actor)]);
  // Só o admin escolhe o login: os livres e o atual de cada profissional.
  const profiles = canEdit
    ? await listLinkableProfiles(actor, {
        keepProfileIds: professionals.flatMap((p) => (p.profileId ? [p.profileId] : [])),
      })
    : [];
  const linkedElsewhere = new Set(professionals.flatMap((p) => (p.profileId ? [p.profileId] : [])));
  const serviceName = new Map(services.map((service) => [service.id, service.name]));
  const profileName = new Map(profiles.map((profile) => [profile.id, profile.fullName]));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold md:text-3xl">{isProfessional ? "Meu cadastro" : "Profissionais"}</h1>
          <p className="mt-1 text-muted-foreground">
            {isProfessional
              ? "Seus dados e os serviços que você realiza."
              : "Profissionais de saúde, serviços que realizam e acesso ao sistema."}
          </p>
        </div>
        {canEdit ? <ProfessionalSheet services={services} profiles={profiles.filter((p) => !linkedElsewhere.has(p.id))} /> : null}
      </header>

      {professionals.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-muted-foreground">
            {isProfessional
              ? "Seu login ainda não está vinculado a um cadastro de profissional. Fale com o administrador."
              : canEdit
                ? "Nenhum profissional cadastrado ainda. Use “Novo profissional” para começar."
                : "Nenhum profissional cadastrado ainda."}
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {professionals.map((professional) => {
            const names = professional.serviceIds.flatMap((id) => {
              const name = serviceName.get(id);
              return name ? [name] : [];
            });
            return (
              <li key={professional.id}>
                <Card className={professional.active ? undefined : "opacity-80"}>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{professional.fullName}</p>
                        <p className="text-sm text-muted-foreground">
                          {specialtyLabel(professional.specialty)}
                          {professional.registration
                            ? ` · ${formatRegistration(professional.specialty, professional.registration)}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge active={professional.active} />
                        {canEdit ? (
                          <>
                            <ProfessionalSheet
                              professional={professional}
                              services={services}
                              profiles={profiles.filter(
                                (p) => p.id === professional.profileId || !linkedElsewhere.has(p.id),
                              )}
                            />
                            <ActiveToggle
                              action={setProfessionalActiveAction}
                              id={professional.id}
                              active={professional.active}
                              name={professional.fullName}
                            />
                          </>
                        ) : null}
                      </div>
                    </div>

                    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Telefone</dt>
                        <dd>{professional.phone ? formatPhone(professional.phone) : "Não informado"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">E-mail</dt>
                        <dd className="break-all">{professional.email ?? "Não informado"}</dd>
                      </div>
                      {canEdit ? (
                        <div className="sm:col-span-2">
                          <dt className="text-muted-foreground">Login de acesso</dt>
                          <dd>
                            {professional.profileId
                              ? (profileName.get(professional.profileId) ?? "Vinculado")
                              : "Sem login vinculado"}
                          </dd>
                        </div>
                      ) : null}
                      <div className="sm:col-span-2">
                        <dt className="text-muted-foreground">Serviços que realiza</dt>
                        <dd>{names.length > 0 ? names.join(", ") : "Nenhum serviço ligado"}</dd>
                      </div>
                    </dl>
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
