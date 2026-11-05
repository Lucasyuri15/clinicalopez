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

/** Opções do pool do app (exportadas para o teste de integração usar a configuração REAL). */
export const APP_POSTGRES_OPTIONS = {
  // `prepare: false`: o pooler do Supabase em modo transação não suporta prepared statements.
  prepare: false,
  max: 5,
  // OBRIGATÓRIO com o pooler em modo transação: o padrão do driver (100) manda consultas
  // enfileiradas na MESMA conexão sem esperar a resposta, e o pooler do Supabase trava
  // (medido: 6 consultas simultâneas sobre `max: 5` já nunca voltavam). Ver pool.test.ts.
  max_pipeline: 1,
  idle_timeout: 20,
} as const;

function getSql() {
  // Singleton em globalThis para não abrir conexões a cada hot reload no dev.
  globalForDb.__sql ??= postgres(getServerEnv().DATABASE_URL, APP_POSTGRES_OPTIONS);
  return globalForDb.__sql;
}

export function getDb() {
  return drizzle(getSql(), { schema });
}

export type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
