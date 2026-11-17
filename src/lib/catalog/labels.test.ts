import { describe, expect, it } from "vitest";

import { SPECIALTIES, specialtyLabel } from "./labels";

describe("specialtyLabel", () => {
  it("traduz cada especialidade para pt-BR", () => {
    expect(SPECIALTIES.map(specialtyLabel)).toEqual(["Fisioterapia", "Odontologia", "Psicologia"]);
  });
});
