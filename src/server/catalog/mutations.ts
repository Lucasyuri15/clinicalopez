import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import type { InsuranceInput, PriceInput, ServiceInput } from "@/lib/catalog/schemas";
import { pgErrorCode } from "@/server/db/pg-error";
import { insurances, servicePrices, services } from "@/server/db/schema";
import { withUser } from "@/server/db/with-user";

import type { CatalogUser } from "./queries";

/**
 * Gravações do catálogo, sempre por `withUser` (a RLS só deixa o admin gravar; a camada de
 * ações ainda exige `requireRole("admin")`). O resultado é um valor, não uma exceção: o erro
 * do banco nunca sobe para a tela.
 * - `duplicate`: nome repetido (índice único).
 * - `not-found`: nenhuma linha afetada (não existe, já removida ou a RLS a esconde).
 * - `denied`: o banco recusou (sem permissão, ou serviço/convênio removido ou inexistente).
 */
export type MutationResult =
  | { ok: true; id: string }
  | { ok: false; reason: "duplicate" | "not-found" | "denied" };

type Failure = Extract<MutationResult, { ok: false }>;

function toFailure(error: unknown): Failure {
  switch (pgErrorCode(error)) {
    case "23505":
      return { ok: false, reason: "duplicate" };
    case "42501": // sem permissão (RLS)
    case "23503": // chave estrangeira
    case "23514": // check (ex.: espaço Unicode na ponta que o Zod não pegou)
    case "22021": // byte inválido no texto (ex.: caractere nulo)
    case "22P02": // texto inválido para o tipo
      return { ok: false, reason: "denied" };
    default:
      // Erro inesperado (conexão, check que o Zod deveria ter barrado...): não engolir.
      throw error;
  }
}

async function guarded(run: () => Promise<MutationResult>): Promise<MutationResult> {
  try {
    return await run();
  } catch (error) {
    return toFailure(error);
  }
}

const touched = (rows: { id: string }[]): MutationResult =>
  rows[0] ? { ok: true, id: rows[0].id } : { ok: false, reason: "not-found" };

export function createService(user: CatalogUser, input: Omit<ServiceInput, "id">) {
  return guarded(async () => {
    const [row] = await withUser(user, (tx) =>
      tx
        .insert(services)
        .values({
          name: input.name,
          specialty: input.specialty,
          durationMinutes: input.durationMinutes,
        })
        .returning({ id: services.id }),
    );
    return touched(row ? [row] : []);
  });
}

export function updateService(user: CatalogUser, input: ServiceInput & { id: string }) {
  return guarded(async () =>
    touched(
      await withUser(user, (tx) =>
        tx
          .update(services)
          .set({
            name: input.name,
            specialty: input.specialty,
            durationMinutes: input.durationMinutes,
          })
          .where(and(eq(services.id, input.id), isNull(services.deletedAt)))
          .returning({ id: services.id }),
      ),
    ),
  );
}

export function setServiceActive(user: CatalogUser, serviceId: string, active: boolean) {
  return guarded(async () =>
    touched(
      await withUser(user, (tx) =>
        tx
          .update(services)
          .set({ active })
          .where(and(eq(services.id, serviceId), isNull(services.deletedAt)))
          .returning({ id: services.id }),
      ),
    ),
  );
}

export function createInsurance(user: CatalogUser, input: Omit<InsuranceInput, "id">) {
  return guarded(async () => {
    const [row] = await withUser(user, (tx) =>
      tx.insert(insurances).values({ name: input.name }).returning({ id: insurances.id }),
    );
    return touched(row ? [row] : []);
  });
}

export function updateInsurance(user: CatalogUser, input: InsuranceInput & { id: string }) {
  return guarded(async () =>
    touched(
      await withUser(user, (tx) =>
        tx
          .update(insurances)
          .set({ name: input.name })
          .where(and(eq(insurances.id, input.id), isNull(insurances.deletedAt)))
          .returning({ id: insurances.id }),
      ),
    ),
  );
}

export function setInsuranceActive(user: CatalogUser, insuranceId: string, active: boolean) {
  return guarded(async () =>
    touched(
      await withUser(user, (tx) =>
        tx
          .update(insurances)
          .set({ active })
          .where(and(eq(insurances.id, insuranceId), isNull(insurances.deletedAt)))
          .returning({ id: insurances.id }),
      ),
    ),
  );
}

/**
 * Define o valor (particular se `insuranceId` for null): atualiza o valor existente ou cria.
 * Dois admins gravando ao mesmo tempo podem esbarrar no índice único: vira `duplicate` e a
 * tela pede para tentar de novo.
 */
export function setPrice(user: CatalogUser, input: PriceInput) {
  return guarded(() =>
    withUser(user, async (tx): Promise<MutationResult> => {
      const [existing] = await tx
        .select({ id: servicePrices.id })
        .from(servicePrices)
        .where(
          and(
            eq(servicePrices.serviceId, input.serviceId),
            input.insuranceId === null
              ? isNull(servicePrices.insuranceId)
              : eq(servicePrices.insuranceId, input.insuranceId),
            isNull(servicePrices.deletedAt),
          ),
        );
      if (existing) {
        return touched(
          await tx
            .update(servicePrices)
            .set({ priceCents: input.priceCents })
            .where(and(eq(servicePrices.id, existing.id), isNull(servicePrices.deletedAt)))
            .returning({ id: servicePrices.id }),
        );
      }
      const [created] = await tx
        .insert(servicePrices)
        .values({
          serviceId: input.serviceId,
          insuranceId: input.insuranceId,
          priceCents: input.priceCents,
        })
        .returning({ id: servicePrices.id });
      return touched(created ? [created] : []);
    }),
  );
}

/** Exclusão lógica do valor (não há DELETE). */
export function removePrice(user: CatalogUser, priceId: string) {
  return guarded(async () =>
    touched(
      await withUser(user, (tx) =>
        tx
          .update(servicePrices)
          .set({ deletedAt: new Date() })
          .where(and(eq(servicePrices.id, priceId), isNull(servicePrices.deletedAt)))
          .returning({ id: servicePrices.id }),
      ),
    ),
  );
}
