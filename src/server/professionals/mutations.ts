import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import type { ProfessionalInput } from "@/lib/professionals/schemas";
import { pgConstraintName, pgErrorCode } from "@/server/db/pg-error";
import { professionalServices, professionals, profiles } from "@/server/db/schema";
import { withUser, type Tx } from "@/server/db/with-user";

import type { ProfessionalUser } from "./queries";

/**
 * Gravações dos profissionais, sempre por `withUser` (a RLS só deixa o admin gravar; a camada de
 * ações ainda exige `requireRole("admin")`). O cadastro e o conjunto de serviços são gravados
 * numa ÚNICA transação: se qualquer passo falhar, nada fica pela metade. O resultado é um valor,
 * não uma exceção: o erro do banco nunca sobe para a tela.
 * - `duplicate-name`: já existe um profissional com esse nome nessa especialidade.
 * - `duplicate-login`: esse login (perfil) já está vinculado a outro profissional.
 * - `not-found`: nenhuma linha afetada (não existe, já removido, ou a RLS o esconde).
 * - `denied`: o banco recusou (sem permissão, serviço de outra especialidade, perfil que não é
 *   `professional`, texto inválido...).
 */
export type ProfessionalResult =
  | { ok: true; id: string }
  | { ok: false; reason: "duplicate-name" | "duplicate-login" | "not-found" | "denied" };

type Failure = Extract<ProfessionalResult, { ok: false }>;

/** Lançada dentro da transação para DESFAZÊ-LA e devolver um resultado já conhecido. */
class Abort extends Error {
  constructor(readonly failure: Failure) {
    super(failure.reason);
  }
}

function toFailure(error: unknown): Failure {
  if (error instanceof Abort) return error.failure;
  switch (pgErrorCode(error)) {
    case "23505": {
      const constraint = pgConstraintName(error);
      if (constraint === "professionals_profile_uq") return { ok: false, reason: "duplicate-login" };
      if (constraint === "professionals_specialty_name_uq") return { ok: false, reason: "duplicate-name" };
      return { ok: false, reason: "denied" };
    }
    case "42501": // sem permissão (RLS)
    case "23503": // chave estrangeira (especialidade do serviço, papel do perfil)
    case "23514": // check
    case "22021": // byte inválido no texto
    case "22P02": // texto inválido para o tipo
      return { ok: false, reason: "denied" };
    default:
      // Erro inesperado (conexão...): não engolir.
      throw error;
  }
}

async function guarded(run: () => Promise<ProfessionalResult>): Promise<ProfessionalResult> {
  try {
    return await run();
  } catch (error) {
    return toFailure(error);
  }
}

type Fields = Omit<ProfessionalInput, "id" | "serviceIds">;

const columns = (fields: Fields) => ({
  fullName: fields.fullName,
  specialty: fields.specialty,
  registration: fields.registration,
  phone: fields.phone,
  email: fields.email,
  profileId: fields.profileId,
});

/**
 * O perfil a vincular precisa estar vivo: papel `professional`, ativo e não removido. A chave
 * estrangeira só garante o papel; um login desativado ou removido seria um vínculo morto.
 */
async function assertLinkableProfile(tx: Tx, profileId: string | null) {
  if (profileId === null) return;
  const [row] = await tx
    .select({ id: profiles.id })
    .from(profiles)
    .where(
      and(
        eq(profiles.id, profileId),
        eq(profiles.role, "professional"),
        eq(profiles.active, true),
        isNull(profiles.deletedAt),
      ),
    );
  if (!row) throw new Abort({ ok: false, reason: "denied" });
}

async function insertServices(tx: Tx, professionalId: string, fields: Fields, serviceIds: string[]) {
  if (serviceIds.length === 0) return;
  await tx
    .insert(professionalServices)
    .values(serviceIds.map((serviceId) => ({ professionalId, serviceId, specialty: fields.specialty })));
}

export function createProfessional(user: ProfessionalUser, input: Omit<ProfessionalInput, "id">) {
  const { serviceIds, ...fields } = input;
  return guarded(() =>
    withUser(user, async (tx): Promise<ProfessionalResult> => {
      await assertLinkableProfile(tx, fields.profileId);
      const [row] = await tx.insert(professionals).values(columns(fields)).returning({ id: professionals.id });
      if (!row) throw new Abort({ ok: false, reason: "denied" });
      await insertServices(tx, row.id, fields, serviceIds);
      return { ok: true, id: row.id };
    }),
  );
}

/**
 * Edita o cadastro e SUBSTITUI o conjunto de serviços. A ordem importa: as ligações antigas
 * saem ANTES de atualizar o profissional, porque a chave estrangeira composta não deixaria
 * trocar a especialidade com serviços da antiga ainda ligados; as novas entram no fim.
 */
export function updateProfessional(user: ProfessionalUser, input: ProfessionalInput & { id: string }) {
  const { id, serviceIds, ...fields } = input;
  return guarded(() =>
    withUser(user, async (tx): Promise<ProfessionalResult> => {
      const [existing] = await tx
        .select({ id: professionals.id, profileId: professionals.profileId })
        .from(professionals)
        .where(and(eq(professionals.id, id), isNull(professionals.deletedAt)));
      if (!existing) throw new Abort({ ok: false, reason: "not-found" });

      // Ao editar, o login atual (se não mudou) segue valendo mesmo que o perfil tenha sido
      // desativado depois: só se valida um login NOVO.
      if (fields.profileId !== existing.profileId) await assertLinkableProfile(tx, fields.profileId);

      await tx.delete(professionalServices).where(eq(professionalServices.professionalId, id));
      const updated = await tx
        .update(professionals)
        .set(columns(fields))
        .where(and(eq(professionals.id, id), isNull(professionals.deletedAt)))
        .returning({ id: professionals.id });
      // Nenhuma linha (a RLS escondeu, ou foi removido agora): desfaz tudo, inclusive o DELETE acima.
      if (!updated[0]) throw new Abort({ ok: false, reason: "not-found" });
      await insertServices(tx, id, fields, serviceIds);
      return { ok: true, id };
    }),
  );
}

export function setProfessionalActive(user: ProfessionalUser, professionalId: string, active: boolean) {
  return guarded(async () => {
    const rows = await withUser(user, (tx) =>
      tx
        .update(professionals)
        .set({ active })
        .where(and(eq(professionals.id, professionalId), isNull(professionals.deletedAt)))
        .returning({ id: professionals.id }),
    );
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, reason: "not-found" };
  });
}
