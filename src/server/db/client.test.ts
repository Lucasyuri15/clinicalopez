import { describe, expect, it } from "vitest";

import { APP_POSTGRES_OPTIONS } from "./client";

/**
 * Trava as opções do pool do app. Cada uma tem um motivo medido; mudar uma é decisão
 * consciente, não acidente.
 */
describe("APP_POSTGRES_OPTIONS", () => {
  it("é compatível com o pooler do Supabase em modo transação", () => {
    expect(APP_POSTGRES_OPTIONS.prepare).toBe(false); // sem prepared statements
    expect(APP_POSTGRES_OPTIONS.max_pipeline).toBe(1); // com o padrão (100) o pooler trava (pool.test.ts)
  });

  it("limita conexões por instância e desiste rápido de conectar", () => {
    expect(APP_POSTGRES_OPTIONS.max).toBe(5);
    // O padrão do driver é 30 s: uma conexão que não sobe seguraria a requisição (e a Server
    // Action de login) por meio minuto. 10 s falha antes, e o limite de login falha fechado.
    expect(APP_POSTGRES_OPTIONS.connect_timeout).toBe(10);
    expect(APP_POSTGRES_OPTIONS.idle_timeout).toBe(20);
  });
});
