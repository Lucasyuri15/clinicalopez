import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { professionals } from "@/server/db/schema";
import type { Tx } from "@/server/db/with-user";

/** Lançada dentro da transação para DESFAZÊ-LA e devolver um resultado já conhecido (um motivo de recusa). */
export class Abort<Reason extends string = string> extends Error {
  constructor(readonly reason: Reason) {
    super(reason);
  }
}

/** O cadastro de profissional ativo e não removido ligado a este login; senão aborta (`denied`). */
export async function authorOf(tx: Tx, userId: string): Promise<string> {
  const [row] = await tx
    .select({ id: professionals.id })
    .from(professionals)
    .where(and(eq(professionals.profileId, userId), isNull(professionals.deletedAt), eq(professionals.active, true)))
    .limit(1);
  if (!row) throw new Abort("denied");
  return row.id;
}
