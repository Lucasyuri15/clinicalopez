import { describe, expect, it } from "vitest";

import { pgConstraintName, pgErrorCode, withoutQueryDetails } from "./pg-error";

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

describe("withoutQueryDetails", () => {
  // O Drizzle monta a mensagem como "Failed query: <sql>\nparams: <valores>": com dado de paciente
  // isso poria CPF, telefone e endereço no log do servidor.
  const leaky = new Error("Failed query: insert into patient_private ...\nparams: 52998224725,Rua Reservada", {
    cause: Object.assign(new Error("connection timeout"), { code: "57014" }),
  });

  it("devolve um erro NOVO, sem a consulta, os parâmetros nem a cadeia `cause`", () => {
    const clean = withoutQueryDetails(leaky);
    expect(clean).toBeInstanceOf(Error);
    expect(clean).not.toBe(leaky);
    expect(clean.message).not.toContain("52998224725");
    expect(clean.message).not.toContain("Rua Reservada");
    expect(clean.message).not.toContain("Failed query");
    expect(clean.cause).toBeUndefined();
  });

  it("mantém só o SQLSTATE, para quem investiga saber a categoria da falha", () => {
    expect(withoutQueryDetails(leaky).message).toContain("57014");
    expect(withoutQueryDetails(new Error("sem código")).message).not.toContain("undefined");
  });

  it("um erro comum de programação (sem consulta) segue como está, com a pilha, para ser depurado", () => {
    const bug = new TypeError("x is not a function");
    expect(withoutQueryDetails(bug)).toBe(bug);
  });

  it("aceita qualquer coisa lançada (texto, null)", () => {
    expect(withoutQueryDetails("params: 1234").message).not.toContain("1234");
    expect(withoutQueryDetails(null)).toBeInstanceOf(Error);
  });
});
