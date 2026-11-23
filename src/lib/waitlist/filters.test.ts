import { describe, expect, it } from "vitest";

import { parseWaitlistFilters, waitlistHref } from "./filters";

const PRO = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";

describe("parseWaitlistFilters", () => {
  it("sem parâmetros: abertas, sem filtro", () => {
    expect(parseWaitlistFilters({})).toEqual({ view: "open", specialty: null, professional: null });
  });

  it("aceita a aba de encerradas, a especialidade e o profissional", () => {
    expect(parseWaitlistFilters({ aba: "encerradas", especialidade: "dentistry", profissional: PRO })).toEqual({
      view: "closed",
      specialty: "dentistry",
      professional: PRO,
    });
  });

  it("qualquer valor inválido volta ao padrão", () => {
    expect(parseWaitlistFilters({ aba: "x", especialidade: "cardio", profissional: "nao-e-uuid" })).toEqual({
      view: "open",
      specialty: null,
      professional: null,
    });
    expect(parseWaitlistFilters({ aba: "ENCERRADAS" }).view).toBe("open");
  });

  it("parâmetro repetido vale o primeiro; espaços e caixa do id são tolerados", () => {
    expect(parseWaitlistFilters({ aba: ["encerradas", "abertas"] }).view).toBe("closed");
    expect(parseWaitlistFilters({ profissional: ` ${PRO.toUpperCase()} ` }).professional).toBe(PRO);
  });
});

describe("waitlistHref", () => {
  it("só põe na URL o que foge do padrão", () => {
    expect(waitlistHref({ view: "open", specialty: null, professional: null })).toBe("/lista-espera");
    expect(waitlistHref({ view: "closed", specialty: null, professional: null })).toBe("/lista-espera?aba=encerradas");
    expect(waitlistHref({ view: "open", specialty: "psychology", professional: PRO })).toBe(
      `/lista-espera?especialidade=psychology&profissional=${PRO}`,
    );
  });
});
