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

  describe("guarda: Auth e banco precisam ser do MESMO projeto Supabase", () => {
    const db = (ref: string) =>
      `postgresql://app_backend.${ref}:senha-fake@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`;
    const url = (ref: string) => `https://${ref}.supabase.co`;

    it("aceita quando o ref da URL pública é o do usuário app_backend.<ref>", () => {
      const env = parseServerEnv({
        DATABASE_URL: db("abcdefghij"),
        NEXT_PUBLIC_SUPABASE_URL: url("abcdefghij"),
      });
      expect(env).toEqual({ DATABASE_URL: db("abcdefghij") });
    });

    it("recusa Auth de um projeto e banco de outro (ex.: Preview misturando dev e produção)", () => {
      expect(() =>
        parseServerEnv({
          DATABASE_URL: db("projetodev"),
          NEXT_PUBLIC_SUPABASE_URL: url("projetoprod"),
        }),
      ).toThrow(/NEXT_PUBLIC_SUPABASE_URL[\s\S]*DATABASE_URL[\s\S]*mesmo projeto/);
    });

    it("não diferencia maiúsculas de minúsculas no ref", () => {
      expect(() =>
        parseServerEnv({
          DATABASE_URL: db("ABCDEFGHIJ"),
          NEXT_PUBLIC_SUPABASE_URL: url("abcdefghij"),
        }),
      ).not.toThrow();
    });

    it("sem a URL pública (a validação dela é de outro módulo) ou sem ref no usuário: não compara", () => {
      expect(() => parseServerEnv({ DATABASE_URL: db("abcdefghij") })).not.toThrow();
      expect(() =>
        parseServerEnv({
          DATABASE_URL: "postgresql://app_backend:senha-fake@localhost:5432/postgres",
          NEXT_PUBLIC_SUPABASE_URL: url("abcdefghij"),
        }),
      ).not.toThrow();
    });

    it("URL que não é <ref>.supabase.co (domínio próprio, Supabase local): não compara", () => {
      for (const custom of ["https://auth.clinica.example", "http://127.0.0.1:54321", "não é url"]) {
        expect(() =>
          parseServerEnv({ DATABASE_URL: db("abcdefghij"), NEXT_PUBLIC_SUPABASE_URL: custom }),
          custom,
        ).not.toThrow();
      }
    });

    it("a mensagem não vaza a senha nem o ref", () => {
      try {
        parseServerEnv({
          DATABASE_URL: db("projetodev"),
          NEXT_PUBLIC_SUPABASE_URL: url("projetoprod"),
        });
        expect.unreachable();
      } catch (error) {
        const message = (error as Error).message;
        expect(message).not.toContain("senha-fake");
        expect(message).not.toContain("projetodev");
        expect(message).not.toContain("projetoprod");
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
