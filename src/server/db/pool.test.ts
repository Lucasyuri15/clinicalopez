import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { APP_POSTGRES_OPTIONS } from "./client";
import { assertMigrationTarget } from "./migration-guard";

/**
 * Regressão (achada na 1A-3): com o pipeline padrão do driver (`max_pipeline` = 100), bastava
 * UMA consulta a mais do que as conexões do pool (6 simultâneas com `max: 5`) para o pooler
 * do Supabase em modo transação travar: sessões ficavam abertas em transação esperando o
 * cliente (`Client/ClientRead`) e as consultas nunca voltavam. Os testes de banco rodavam
 * em sequência, então ninguém via. Usa a configuração REAL do app contra o Supabase dev.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);

describe.skipIf(!hasDb)("pool do app (integração, Supabase dev)", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    sql = postgres(process.env.DATABASE_URL ?? "", {
      ...APP_POSTGRES_OPTIONS,
      onnotice: () => {},
      connect_timeout: 10,
    });
  });
  afterAll(async () => {
    await sql?.end({ timeout: 2 });
  });

  it("mais consultas simultâneas do que conexões (20 sobre 5) terminam, sem travar o pooler", async () => {
    const total = 20;
    expect(total).toBeGreaterThan(APP_POSTGRES_OPTIONS.max);
    const rows = await Promise.all(
      Array.from({ length: total }, (_, i) => sql<{ n: number }[]>`select ${i}::int as n, pg_sleep(0.02)`),
    );
    expect(rows.map((r) => r[0]?.n)).toEqual(Array.from({ length: total }, (_, i) => i));
  }, 20_000);
});
