import { describe, expect, it } from "vitest";

import { ageInYears, isUnderAge } from "./age";

describe("isUnderAge (maioridade aos 18)", () => {
  it("é menor até a véspera do aniversário de 18 anos", () => {
    expect(isUnderAge("2008-11-18", "2026-11-17")).toBe(true);
  });

  it("deixa de ser menor no próprio dia do aniversário", () => {
    expect(isUnderAge("2008-11-18", "2026-11-18")).toBe(false);
    expect(isUnderAge("2008-11-18", "2026-11-19")).toBe(false);
  });

  it("recém-nascido e adulto antigo", () => {
    expect(isUnderAge("2026-11-18", "2026-11-18")).toBe(true);
    expect(isUnderAge("1950-01-01", "2026-11-18")).toBe(false);
  });

  it("nascido em 29/02: em ano sem 29/02 a maioridade vale em 1º/03", () => {
    expect(isUnderAge("2008-02-29", "2026-02-28")).toBe(true);
    expect(isUnderAge("2008-02-29", "2026-03-01")).toBe(false);
  });

  it("nascido em 29/02 com ano de corte bissexto: vale no próprio 29/02", () => {
    expect(isUnderAge("2008-02-29", "2024-02-28", 16)).toBe(true);
    expect(isUnderAge("2008-02-29", "2024-02-29", 16)).toBe(false);
  });

  it("aceita outra idade de corte", () => {
    expect(isUnderAge("2010-06-01", "2026-11-18", 16)).toBe(false);
    expect(isUnderAge("2012-06-01", "2026-11-18", 16)).toBe(true);
  });
});

describe("ageInYears", () => {
  it("conta anos completos", () => {
    expect(ageInYears("1990-05-10", "2026-11-18")).toBe(36);
    expect(ageInYears("1990-11-18", "2026-11-18")).toBe(36); // faz anos hoje
    expect(ageInYears("1990-11-19", "2026-11-18")).toBe(35); // faz amanhã
  });
  it("recém-nascido tem 0 anos", () => {
    expect(ageInYears("2026-11-18", "2026-11-18")).toBe(0);
    expect(ageInYears("2026-01-01", "2026-11-18")).toBe(0);
  });
  it("nascido em 29/02 completa em 1º/03 nos anos sem 29/02", () => {
    expect(ageInYears("2000-02-29", "2026-02-28")).toBe(25);
    expect(ageInYears("2000-02-29", "2026-03-01")).toBe(26);
  });
  it("concorda com isUnderAge: menor de 18 se, e só se, idade < 18", () => {
    for (const [birth, today] of [
      ["2008-11-18", "2026-11-17"],
      ["2008-11-18", "2026-11-18"],
      ["2008-02-29", "2026-02-28"],
      ["2008-02-29", "2026-03-01"],
    ] as const) {
      expect(ageInYears(birth, today) < 18, `${birth} ${today}`).toBe(isUnderAge(birth, today));
    }
  });
});
