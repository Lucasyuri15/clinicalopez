import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { insurances, servicePrices, services } from "@/server/db/schema";
import { withUser } from "@/server/db/with-user";

/**
 * Consultas do catálogo. Todas passam por `withUser` (RLS de verdade): quem NÃO pode ver
 * valores ou convênios (profissional) recebe lista vazia do próprio banco; o código não
 * duplica essa regra por papel. Os filtros `deleted_at is null` aqui são de exibição (o admin
 * enxerga também as linhas removidas pela RLS, mas a tela nunca as mostra).
 */
export type CatalogUser = { userId: string };

export type ServiceRow = Pick<
  typeof services.$inferSelect,
  "id" | "name" | "specialty" | "durationMinutes" | "active"
>;
export type InsuranceRow = { id: string; name: string; active: boolean };
export type PriceRow = { id: string; serviceId: string; priceCents: number };

const uuid = z.guid();

export async function listServices(user: CatalogUser): Promise<ServiceRow[]> {
  return withUser(user, (tx) =>
    tx
      .select({
        id: services.id,
        name: services.name,
        specialty: services.specialty,
        durationMinutes: services.durationMinutes,
        active: services.active,
      })
      .from(services)
      .where(isNull(services.deletedAt))
      // Ordem fixa (enum = ordem de declaração: fisioterapia, odontologia, psicologia), depois o nome.
      .orderBy(asc(services.specialty), asc(services.name)),
  );
}

export async function listInsurances(user: CatalogUser): Promise<InsuranceRow[]> {
  return withUser(user, (tx) =>
    tx
      .select({ id: insurances.id, name: insurances.name, active: insurances.active })
      .from(insurances)
      .where(isNull(insurances.deletedAt))
      .orderBy(asc(insurances.name)),
  );
}

/** `null` para removido, inexistente, sem permissão ou id que não é UUID (nunca estoura). */
export async function getInsurance(
  user: CatalogUser,
  insuranceId: string,
): Promise<InsuranceRow | null> {
  if (!uuid.safeParse(insuranceId).success) return null;
  const [row] = await withUser(user, (tx) =>
    tx
      .select({ id: insurances.id, name: insurances.name, active: insurances.active })
      .from(insurances)
      .where(and(eq(insurances.id, insuranceId), isNull(insurances.deletedAt))),
  );
  return row ?? null;
}

/** Valor particular (sem convênio) de cada serviço que tem um, só de serviços não removidos. */
export async function listParticularPrices(user: CatalogUser): Promise<PriceRow[]> {
  return withUser(user, (tx) =>
    tx
      .select({
        id: servicePrices.id,
        serviceId: servicePrices.serviceId,
        priceCents: servicePrices.priceCents,
      })
      .from(servicePrices)
      .innerJoin(services, eq(services.id, servicePrices.serviceId))
      .where(
        and(
          isNull(servicePrices.insuranceId),
          isNull(servicePrices.deletedAt),
          isNull(services.deletedAt),
        ),
      ),
  );
}

/** Valores de um convênio, por serviço (só serviços e valores não removidos). */
export async function listInsurancePrices(
  user: CatalogUser,
  insuranceId: string,
): Promise<PriceRow[]> {
  if (!uuid.safeParse(insuranceId).success) return [];
  return withUser(user, (tx) =>
    tx
      .select({
        id: servicePrices.id,
        serviceId: servicePrices.serviceId,
        priceCents: servicePrices.priceCents,
      })
      .from(servicePrices)
      .innerJoin(services, eq(services.id, servicePrices.serviceId))
      .where(
        and(
          eq(servicePrices.insuranceId, insuranceId),
          isNull(servicePrices.deletedAt),
          isNull(services.deletedAt),
        ),
      ),
  );
}
