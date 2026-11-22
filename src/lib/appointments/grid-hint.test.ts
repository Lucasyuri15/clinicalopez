import { describe, expect, it } from "vitest";

import { gridDays } from "./grid-hint";

describe("gridDays (a dica da grade na hora de agendar)", () => {
  it("lista só os dias com atendimento, de segunda a domingo", () => {
    const days = gridDays([
      { weekday: 6, start: 480, end: 720 },
      { weekday: 1, start: 840, end: 1080 },
      { weekday: 1, start: 480, end: 720 },
    ]);
    expect(days).toEqual([
      { label: "Segunda-feira", text: "08:00–12:00 · 14:00–18:00" },
      { label: "Sábado", text: "08:00–12:00" },
    ]);
  });

  it("sem grade cadastrada devolve lista vazia (a tela avisa)", () => {
    expect(gridDays([])).toEqual([]);
  });

  it("domingo vem por último", () => {
    const days = gridDays([
      { weekday: 0, start: 480, end: 600 },
      { weekday: 3, start: 480, end: 600 },
    ]);
    expect(days.map((d) => d.label)).toEqual(["Quarta-feira", "Domingo"]);
  });
});
