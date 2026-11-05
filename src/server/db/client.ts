import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getServerEnv } from "../env";
import * as schema from "./schema";

/**
 * Cliente cru do banco, conectado como `app_backend` (sem BYPASSRLS e sem
 * privilégios próprios). NÃO importe fora de src/server/db/: todo acesso a dados
 * passa por `withUser` (ver with-user.ts), que assume o usuário logado para a RLS valer.
 */

const globalForDb = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
};

function getSql() {
  // `prepare: false`: o pooler do Supabase em modo transação não suporta prepared statements.
  // Singleton em globalThis para não abrir conexões a cada hot reload no dev.
  globalForDb.__sql ??= postgres(getServerEnv().DATABASE_URL, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
  });
  return globalForDb.__sql;
}

export function getDb() {
  return drizzle(getSql(), { schema });
}

export type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
