import { describe, expect, it } from "vitest";

import { SPECIALTIES } from "@/lib/catalog/labels";

import { councilLabel, formatRegistration } from "./labels";

describe("councilLabel", () => {
  it("cada especialidade tem o seu conselho profissional", () => {
    expect(SPECIALTIES.map(councilLabel)).toEqual(["CREFITO", "CRO", "CRP"]);
  });
});

describe("formatRegistration", () => {
  it("antepõe o conselho ao número", () => {
    expect(formatRegistration("physiotherapy", "12345-F")).toBe("CREFITO 12345-F");
    expect(formatRegistration("dentistry", "12345")).toBe("CRO 12345");
    expect(formatRegistration("psychology", "06/99999")).toBe("CRP 06/99999");
  });

  it("não repete o conselho se quem cadastrou já o digitou (qualquer caixa)", () => {
    expect(formatRegistration("physiotherapy", "CREFITO 12345")).toBe("CREFITO 12345");
    expect(formatRegistration("physiotherapy", "crefito-3/12345")).toBe("crefito-3/12345");
    expect(formatRegistration("dentistry", "CRO-SP 998")).toBe("CRO-SP 998");
  });

  it("não confunde um número que apenas começa com letras parecidas", () => {
    expect(formatRegistration("dentistry", "CROMO 1")).toBe("CRO CROMO 1");
  });

  it("sem registro devolve null", () => {
    expect(formatRegistration("psychology", null)).toBeNull();
    expect(formatRegistration("psychology", "")).toBeNull();
  });
});
