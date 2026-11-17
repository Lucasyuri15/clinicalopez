import "server-only";

import { and, asc, eq, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { Specialty } from "@/lib/catalog/labels";
import {
  professionalServices,
  professionals,
  profiles,
  services,
} from "@/server/db/schema";
import { withUser } from "@/server/db/with-user";

/**
 * Consultas dos profissionais. Todas passam por `withUser` (RLS de verdade): a recepção recebe
 * todos os não removidos; o PROFISSIONAL recebe só a própria linha (e só os serviços dele); o
 * código não repete essa regra por papel. `deleted_at is null` aqui é de exibição (o admin
 * enxerga também os removidos pela RLS, mas a tela nunca os mostra).
 */
export type ProfessionalUser = { userId: string };

export type ProfessionalRow = {
  id: string;
  fullName: string;
  specialty: Specialty;
  registration: string | null;
  /** Só dígitos (DDD + número). */
  phone: string | null;
  email: string | null;
  /** Perfil de login vinculado, se houver. */
  profileId: string | null;
  active: boolean;
  /** Serviços que realiza (só os não removidos). */
  serviceIds: string[];
};

/** `active` = o perfil está ativo e não removido; um login já vinculado pode ter deixado de estar. */
export type LinkableProfile = { id: string; fullName: string; active: boolean };

const uuid = z.guid();

export async function listProfessionals(user: ProfessionalUser): Promise<ProfessionalRow[]> {
  return withUser(user, async (tx) => {
    const rows = await tx
      .select({
        id: professionals.id,
        fullName: professionals.fullName,
        specialty: professionals.specialty,
        registration: professionals.registration,
        phone: professionals.phone,
        email: professionals.email,
        profileId: professionals.profileId,
        active: professionals.active,
      })
      .from(professionals)
      .where(isNull(professionals.deletedAt))
      // Ordem fixa: especialidade (ordem do enum) e nome.
      .orderBy(asc(professionals.specialty), asc(professionals.fullName));
    if (rows.length === 0) return [];

    const links = await tx
      .select({ professionalId: professionalServices.professionalId, serviceId: professionalServices.serviceId })
      .from(professionalServices)
      .innerJoin(services, eq(services.id, professionalServices.serviceId))
      .where(
        and(
          inArray(professionalServices.professionalId, rows.map((row) => row.id)),
          isNull(services.deletedAt),
        ),
      );
    const byProfessional = new Map<string, string[]>();
    for (const link of links) {
      byProfessional.set(link.professionalId, [
        ...(byProfessional.get(link.professionalId) ?? []),
        link.serviceId,
      ]);
    }
    return rows.map((row) => ({ ...row, serviceIds: byProfessional.get(row.id) ?? [] }));
  });
}

/**
 * Perfis de login que podem ser vinculados a um profissional: papel `professional`, ativos,
 * não removidos e ainda sem profissional (não removido) vinculado. `keepProfileIds` mantém
 * na lista os perfis JÁ vinculados, mesmo desativados (`active: false`), para a tela de edição
 * mostrar o login atual de cada um. Só o admin enxerga perfis de outras pessoas (RLS): para os
 * demais papéis a lista não traz ninguém além, no máximo, do próprio perfil.
 */
export async function listLinkableProfiles(
  user: ProfessionalUser,
  options: { keepProfileIds?: readonly string[] } = {},
): Promise<LinkableProfile[]> {
  const keep = (options.keepProfileIds ?? []).filter((id) => uuid.safeParse(id).success);
  return withUser(user, async (tx) => {
    const rows = await tx
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        active: profiles.active,
        deletedAt: profiles.deletedAt,
      })
      .from(profiles)
      .where(
        and(
          eq(profiles.role, "professional"),
          or(
            // Os já vinculados ficam SEMPRE na lista, mesmo que o perfil tenha sido desativado ou
            // removido depois: sem isso a tela de edição não teria a opção e salvaria "sem login".
            keep.length > 0 ? inArray(profiles.id, keep) : undefined,
            and(
              eq(profiles.active, true),
              isNull(profiles.deletedAt),
              notExists(
                tx
                  .select({ one: sql`1` })
                  .from(professionals)
                  .where(and(eq(professionals.profileId, profiles.id), isNull(professionals.deletedAt))),
              ),
            ),
          ),
        ),
      )
      .orderBy(asc(profiles.fullName));
    return rows.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      active: row.active && row.deletedAt === null,
    }));
  });
}
