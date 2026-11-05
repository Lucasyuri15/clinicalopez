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

  describe("CLIENT_IP_HEADER (cabeçalho com o IP do cliente, opcional)", () => {
    it("é opcional: sem ele nada muda", () => {
      expect(parseServerEnv(valid).CLIENT_IP_HEADER).toBeUndefined();
    });

    it("aceita um nome de cabeçalho HTTP", () => {
      for (const name of ["x-real-ip", "X-Forwarded-For", "cf-connecting-ip"]) {
        expect(parseServerEnv({ ...valid, CLIENT_IP_HEADER: name }).CLIENT_IP_HEADER).toBe(name);
      }
    });

    it("string vazia (linha em branco do .env) vale como ausente", () => {
      expect(parseServerEnv({ ...valid, CLIENT_IP_HEADER: "" }).CLIENT_IP_HEADER).toBeUndefined();
    });

    it("recusa valor que não é nome de cabeçalho (nada de lista, espaço ou caractere estranho)", () => {
      for (const bad of ["x real ip", "x-real-ip, x-forwarded-for", "ip;drop", "á", "x".repeat(65)]) {
        expect(() => parseServerEnv({ ...valid, CLIENT_IP_HEADER: bad }), bad).toThrow(/CLIENT_IP_HEADER/);
      }
    });
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
