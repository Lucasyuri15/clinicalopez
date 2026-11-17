import { describe, expect, it } from "vitest";

import { pgConstraintName, pgErrorCode } from "./pg-error";

describe("pgErrorCode", () => {
  it("lê o SQLSTATE direto ou dentro de `cause` (como o Drizzle embrulha o erro do driver)", () => {
    expect(pgErrorCode({ code: "23505" })).toBe("23505");
    expect(pgErrorCode(new Error("x", { cause: { code: "42501" } }))).toBe("42501");
  });

  it("ignora códigos que não são SQLSTATE (ex.: erros de rede) e entradas estranhas", () => {
    expect(pgErrorCode({ code: "ECONNRESET" })).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
    expect(pgErrorCode("erro")).toBeUndefined();
  });
});

describe("pgConstraintName", () => {
  it("lê o nome da restrição que falhou, direto ou dentro de `cause`", () => {
    expect(pgConstraintName({ code: "23505", constraint_name: "professionals_profile_uq" })).toBe(
      "professionals_profile_uq",
    );
    expect(
      pgConstraintName(new Error("x", { cause: { code: "23505", constraint_name: "professionals_specialty_name_uq" } })),
    ).toBe("professionals_specialty_name_uq");
  });

  it("devolve undefined quando não há nome, ou o nome não é texto", () => {
    expect(pgConstraintName({ code: "23505" })).toBeUndefined();
    expect(pgConstraintName({ constraint_name: 42 })).toBeUndefined();
    expect(pgConstraintName(undefined)).toBeUndefined();
  });
});
