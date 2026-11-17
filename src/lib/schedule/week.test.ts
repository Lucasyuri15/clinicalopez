import { describe, expect, it } from "vitest";

import { MAX_RANGES_PER_DAY, summarizeWeek, validateWeek, type WorkRange } from "./week";

const r = (weekday: number, start: number, end: number): WorkRange => ({ weekday, start, end });
const H = (hours: number, minutes = 0) => hours * 60 + minutes;

const errorOf = (ranges: WorkRange[]) => {
  const result = validateWeek(ranges);
  return result.ok ? null : result.error;
};

describe("validateWeek", () => {
  it("aceita uma semana vazia", () => {
    expect(validateWeek([])).toEqual({ ok: true, ranges: [] });
  });

  it("aceita faixas com intervalo, em dias diferentes, e devolve ordenado por dia e horário", () => {
    const result = validateWeek([r(2, H(14), H(18)), r(1, H(14), H(18)), r(1, H(8), H(12))]);
    expect(result).toEqual({ ok: true, ranges: [r(1, H(8), H(12)), r(1, H(14), H(18)), r(2, H(14), H(18))] });
  });

  it("faixas que ENCOSTAM (12:00 fim e 12:00 início) não se sobrepõem", () => {
    expect(validateWeek([r(1, H(8), H(12)), r(1, H(12), H(14))]).ok).toBe(true);
  });

  it("aceita os limites do dia (00:00 até 24:00) e o passo de 5 minutos", () => {
    expect(validateWeek([r(0, 0, 1440)]).ok).toBe(true);
    expect(validateWeek([r(3, H(8, 5), H(8, 10))]).ok).toBe(true);
  });

  it("mesma faixa em dias diferentes não é conflito", () => {
    expect(validateWeek([r(1, H(8), H(12)), r(2, H(8), H(12))]).ok).toBe(true);
  });

  it.each([
    ["sobreposição parcial", [r(1, H(8), H(12)), r(1, H(11), H(14))], "Segunda-feira: as faixas 08:00–12:00 e 11:00–14:00 se sobrepõem."],
    ["uma faixa dentro da outra", [r(4, H(8), H(18)), r(4, H(10), H(11))], "Quinta-feira: as faixas 08:00–18:00 e 10:00–11:00 se sobrepõem."],
    ["faixa repetida", [r(6, H(8), H(12)), r(6, H(8), H(12))], "Sábado: as faixas 08:00–12:00 e 08:00–12:00 se sobrepõem."],
    ["fim igual ao início", [r(1, H(8), H(8))], "Segunda-feira: o fim deve ser depois do início."],
    ["fim antes do início", [r(1, H(12), H(8))], "Segunda-feira: o fim deve ser depois do início."],
    ["início fora do passo de 5", [r(2, H(8, 3), H(12))], "Terça-feira: os horários devem ser de 5 em 5 minutos."],
    ["fim fora do passo de 5", [r(2, H(8), H(12, 7))], "Terça-feira: os horários devem ser de 5 em 5 minutos."],
    ["fim depois do dia (24:05)", [r(3, H(8), 1445)], "Quarta-feira: os horários devem ficar entre 00:00 e 24:00."],
    ["início negativo", [r(3, -5, H(8))], "Quarta-feira: os horários devem ficar entre 00:00 e 24:00."],
    ["dia fora de 0 a 6", [r(7, H(8), H(12))], "Dia da semana inválido."],
    ["dia não inteiro", [r(1.5, H(8), H(12))], "Dia da semana inválido."],
    ["minuto não inteiro", [r(1, 480.5, H(12))], "Segunda-feira: os horários devem ser de 5 em 5 minutos."],
  ])("recusa %s", (_label, ranges, message) => {
    expect(errorOf(ranges)).toBe(message);
  });

  it("limita as faixas por dia", () => {
    const day = (n: number) => Array.from({ length: n }, (_, i) => r(1, H(i * 2), H(i * 2 + 1)));
    expect(validateWeek(day(MAX_RANGES_PER_DAY)).ok).toBe(true);
    expect(errorOf(day(MAX_RANGES_PER_DAY + 1))).toBe(
      `Segunda-feira: no máximo ${MAX_RANGES_PER_DAY} faixas por dia.`,
    );
  });

  it("não altera a lista recebida", () => {
    const input = [r(2, H(14), H(18)), r(1, H(8), H(12))];
    const copy = structuredClone(input);
    validateWeek(input);
    expect(input).toEqual(copy);
  });
});

describe("summarizeWeek", () => {
  it("resume por dia (segunda a domingo), com as faixas em ordem e 'Sem atendimento' nos vazios", () => {
    const summary = summarizeWeek([r(1, H(14), H(18)), r(1, H(8), H(12)), r(6, H(8), H(12, 30))]);
    expect(summary.map((day) => day.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(summary[0]).toEqual({ weekday: 1, label: "Segunda-feira", text: "08:00–12:00 · 14:00–18:00" });
    expect(summary[1]).toEqual({ weekday: 2, label: "Terça-feira", text: "Sem atendimento" });
    expect(summary[5]).toEqual({ weekday: 6, label: "Sábado", text: "08:00–12:30" });
    expect(summary[6]).toEqual({ weekday: 0, label: "Domingo", text: "Sem atendimento" });
  });

  it("uma semana vazia resume sete dias sem atendimento", () => {
    expect(summarizeWeek([]).every((day) => day.text === "Sem atendimento")).toBe(true);
  });
});
