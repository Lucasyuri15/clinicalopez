import { describe, expect, it } from "vitest";

import { parsePublicEnv } from "./env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghij.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_chave-fake-123",
};

describe("parsePublicEnv", () => {
  it("aceita a URL https e a chave publishable", () => {
    expect(parsePublicEnv(valid)).toEqual({
      url: "https://abcdefghij.supabase.co",
      publishableKey: "sb_publishable_chave-fake-123",
    });
  });

  it("falha em pt-BR citando o nome da variável ausente", () => {
    expect(() =>
      parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: valid.NEXT_PUBLIC_SUPABASE_URL }),
    ).toThrow(/ausentes ou inválidas.*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("rejeita URL que não é https", () => {
    expect(() =>
      parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "http://abcdefghij.supabase.co" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("rejeita uma chave secret colada por engano (ela iria para o navegador)", () => {
    expect(() =>
      parsePublicEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_segredo-fake-999",
      }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("rejeita chave que não tem o formato sb_publishable_", () => {
    expect(() =>
      parsePublicEnv({ ...valid, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "qualquer-coisa" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("nunca inclui o valor da chave na mensagem de erro", () => {
    let message = "";
    try {
      parsePublicEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_segredo-fake-999",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("segredo-fake-999");
  });
});
