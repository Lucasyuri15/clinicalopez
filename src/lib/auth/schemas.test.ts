import { describe, expect, it } from "vitest";

import { loginSchema, totpCodeSchema } from "./schemas";

describe("loginSchema", () => {
  it("aceita e normaliza o e-mail (trim + minúsculas)", () => {
    const parsed = loginSchema.parse({ email: "  Maria@Clinica.COM ", password: "x" });
    expect(parsed.email).toBe("maria@clinica.com");
  });

  it("não altera a senha (espaços fazem parte dela)", () => {
    expect(loginSchema.parse({ email: "a@b.co", password: "  s3nha  " }).password).toBe("  s3nha  ");
  });

  it("rejeita e-mail inválido com mensagem em pt-BR", () => {
    const result = loginSchema.safeParse({ email: "nao-e-email", password: "x" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Informe um e-mail válido.");
  });

  it("rejeita senha vazia com mensagem em pt-BR", () => {
    const result = loginSchema.safeParse({ email: "a@b.co", password: "" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Informe a senha.");
  });

  it("limita o tamanho dos campos (evita abuso)", () => {
    expect(loginSchema.safeParse({ email: `${"a".repeat(300)}@b.co`, password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "x".repeat(1000) }).success).toBe(false);
  });
});

describe("totpCodeSchema", () => {
  it("aceita 6 dígitos, com espaços ao redor ou no meio", () => {
    expect(totpCodeSchema.parse("123456")).toBe("123456");
    expect(totpCodeSchema.parse(" 123 456 ")).toBe("123456");
  });

  it("rejeita tamanho errado, letras e vazio, com mensagem em pt-BR", () => {
    for (const bad of ["12345", "1234567", "12345a", "", "abcdef", "12-456"]) {
      const result = totpCodeSchema.safeParse(bad);
      expect(result.success, bad).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("Informe o código de 6 dígitos.");
    }
  });
});
