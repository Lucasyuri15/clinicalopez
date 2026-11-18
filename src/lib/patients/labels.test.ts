import { describe, expect, it } from "vitest";

import { formatAge, formatBirthDate, UFS } from "./labels";

describe("formatBirthDate", () => {
  it("AAAA-MM-DD vira DD/MM/AAAA, sem passar por fuso", () => {
    expect(formatBirthDate("1990-05-10")).toBe("10/05/1990");
    expect(formatBirthDate("1900-01-01")).toBe("01/01/1900");
  });
  it("devolve o texto como está se não for uma data AAAA-MM-DD", () => {
    expect(formatBirthDate("")).toBe("");
    expect(formatBirthDate("10/05/1990")).toBe("10/05/1990");
  });
});

describe("UFS", () => {
  it("tem as 27 unidades da Federação, sem repetição", () => {
    expect(UFS).toHaveLength(27);
    expect(new Set(UFS).size).toBe(27);
    expect(UFS).toContain("SP");
    expect(UFS).toContain("DF");
  });
});

describe("formatAge", () => {
  it("singular, plural e bebê", () => {
    expect(formatAge(0)).toBe("menos de 1 ano");
    expect(formatAge(1)).toBe("1 ano");
    expect(formatAge(2)).toBe("2 anos");
    expect(formatAge(36)).toBe("36 anos");
  });
});
