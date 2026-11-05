import { describe, expect, it } from "vitest";

import { parseServerEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://app_backend.proj:senha-fake@host.example:6543/postgres",
  DIRECT_URL: "postgresql://postgres:senha-fake@db.example:5432/postgres",
};

describe("parseServerEnv", () => {
  it("aceita as duas URLs de conexão válidas", () => {
    expect(parseServerEnv(valid)).toEqual(valid);
  });

  it("aceita o esquema postgres://", () => {
    const env = parseServerEnv({
      ...valid,
      DATABASE_URL: "postgres://u:p@host.example:6543/postgres",
    });
    expect(env.DATABASE_URL).toMatch(/^postgres:\/\//);
  });

  it("falha em pt-BR citando a variável ausente", () => {
    expect(() => parseServerEnv({ DIRECT_URL: valid.DIRECT_URL })).toThrow(
      /ausentes ou inválidas.*DATABASE_URL/i,
    );
  });

  it("falha quando a variável é string vazia", () => {
    expect(() => parseServerEnv({ ...valid, DIRECT_URL: "" })).toThrow(/DIRECT_URL/);
  });

  it("rejeita URL que não é de Postgres", () => {
    expect(() =>
      parseServerEnv({ ...valid, DATABASE_URL: "https://example.com" }),
    ).toThrow(/DATABASE_URL/);
  });

  it("nunca inclui o valor (segredo) na mensagem de erro", () => {
    let message = "";
    try {
      parseServerEnv({ ...valid, DATABASE_URL: "mysql://u:senha-fake@host/db" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("senha-fake");
  });
});
