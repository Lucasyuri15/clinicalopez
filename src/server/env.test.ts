import { describe, expect, it } from "vitest";

import { parseServerEnv } from "./env";

const valid = {
  DATABASE_URL:
    "postgresql://app_backend.proj:senha-fake@host.example:6543/postgres",
};

describe("parseServerEnv", () => {
  it("aceita a URL de conexão do app (papel app_backend)", () => {
    expect(parseServerEnv(valid)).toEqual(valid);
  });

  it("aceita o esquema postgres://", () => {
    const env = parseServerEnv({
      DATABASE_URL: "postgres://app_backend.proj:p@host.example:6543/postgres",
    });
    expect(env.DATABASE_URL).toMatch(/^postgres:\/\//);
  });

  it("não exige nem expõe DIRECT_URL (credencial do dono do banco, só para migrações)", () => {
    const env = parseServerEnv({
      ...valid,
      DIRECT_URL: "postgresql://postgres.proj:senha-do-dono@host.example:5432/postgres",
    });
    expect(env).toEqual(valid);
    expect(env).not.toHaveProperty("DIRECT_URL");
  });

  it("falha em pt-BR citando a variável ausente", () => {
    expect(() => parseServerEnv({})).toThrow(
      /ausentes ou inválidas.*DATABASE_URL/i,
    );
  });

  it("falha quando a variável é string vazia", () => {
    expect(() => parseServerEnv({ DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  it("rejeita URL que não é de Postgres", () => {
    expect(() =>
      parseServerEnv({ DATABASE_URL: "https://example.com" }),
    ).toThrow(/DATABASE_URL/);
  });

  it("recusa que o app rode com o papel dono (postgres) em vez de app_backend", () => {
    expect(() =>
      parseServerEnv({
        DATABASE_URL: "postgresql://postgres.proj:senha-fake@host.example:6543/postgres",
      }),
    ).toThrow(/app_backend/);
  });

  it("nunca inclui o valor (segredo) na mensagem de erro", () => {
    const messages: string[] = [];
    for (const url of [
      "mysql://u:senha-fake@host/db",
      "postgresql://postgres.proj:senha-fake@host.example:6543/postgres",
    ]) {
      try {
        parseServerEnv({ DATABASE_URL: url });
      } catch (error) {
        messages.push((error as Error).message);
      }
    }
    expect(messages).toHaveLength(2);
    for (const message of messages) expect(message).not.toContain("senha-fake");
  });
});
