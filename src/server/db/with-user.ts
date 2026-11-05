import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, type Tx } from "./client";

// Código de negócio importa o tipo daqui (o módulo do cliente cru é proibido fora de db/).
export type { Tx };

const userIdSchema = z.guid();

/**
 * Faz a transação agir como o usuário: assume o papel `authenticated` e informa os
 * claims do JWT (`sub` e `aal`), de modo que `auth.uid()`, `auth.jwt()` e as políticas
 * de RLS valham. `set local` + `set_config(..., true)` só duram até o fim da transação.
 *
 * `aal` padrão = `aal2`: o app só chega aqui depois de verificar o JWT com 2FA
 * (`getSessionState`). Os testes usam `aal1` para provar que a RLS barra quem só tem
 * a senha (o que vale também para a Data API do Supabase, fora deste app).
 */
export async function applyUserContext(
  tx: Tx,
  userId: string,
  aal: "aal1" | "aal2" = "aal2",
): Promise<void> {
  const parsed = userIdSchema.safeParse(userId);
  if (!parsed.success) {
    throw new Error("userId inválido: esperado um UUID.");
  }
  const claims = JSON.stringify({ sub: parsed.data, role: "authenticated", aal });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role authenticated`);
}

/**
 * ÚNICO ponto de acesso ao banco para código de negócio. Abre uma transação sob
 * RLS como `userId` e executa `fn`. A autorização por perfil continua sendo feita
 * no servidor (camada de acesso a dados); a RLS é a segunda camada.
 */
export async function withUser<T>(
  user: { userId: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  // Valida antes de abrir conexão.
  if (!userIdSchema.safeParse(user.userId).success) {
    throw new Error("userId inválido: esperado um UUID.");
  }
  return getDb().transaction(async (tx) => {
    await applyUserContext(tx, user.userId);
    return fn(tx);
  });
}
