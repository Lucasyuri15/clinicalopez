import { describe, expect, it } from "vitest";

import {
  DAY_MINUTES,
  formatTime,
  parseTime,
  STEP_MINUTES,
  WEEKDAY_ORDER,
  weekdayLabel,
} from "./time";

describe("parseTime", () => {
  it.each([
    ["00:00", 0],
    ["08:00", 480],
    ["08:05", 485],
    ["12:30", 750],
    ["23:55", 1435],
    ["24:00", 1440], // fim do dia (só faz sentido como horário de término)
  ])("lê %j como %i minutos", (text, minutes) => {
    expect(parseTime(text)).toBe(minutes);
  });

  it.each([
    [""],
    ["8:00"],
    ["08:0"],
    ["08:7"],
    ["8:7"],
    ["24:01"],
    ["24:30"],
    ["25:00"],
    ["23:60"],
    ["-1:00"],
    ["08-00"],
    ["08:00:00"],
    [" 08:00"],
    ["08:00 "],
    ["oito"],
    ["٠٨:٠٠"], // dígitos que não são ASCII
  ])("recusa %j", (text) => {
    expect(parseTime(text)).toBeNull();
  });

  it("não impõe o passo de 5 minutos (isso é da validação da semana)", () => {
    expect(parseTime("08:03")).toBe(483);
  });
});

describe("formatTime", () => {
  it.each([
    [0, "00:00"],
    [485, "08:05"],
    [750, "12:30"],
    [1435, "23:55"],
    [1440, "24:00"],
  ])("%i minutos viram %j", (minutes, text) => {
    expect(formatTime(minutes)).toBe(text);
  });

  it("ida e volta com parseTime", () => {
    for (let minutes = 0; minutes <= DAY_MINUTES; minutes += STEP_MINUTES) {
      expect(parseTime(formatTime(minutes))).toBe(minutes);
    }
  });

  it("recusa valores que não são minutos de um dia", () => {
    expect(() => formatTime(-1)).toThrow(RangeError);
    expect(() => formatTime(1441)).toThrow(RangeError);
    expect(() => formatTime(10.5)).toThrow(RangeError);
    expect(() => formatTime(Number.NaN)).toThrow(RangeError);
  });
});

describe("dias da semana", () => {
  it("0 é domingo (como Date.getDay e o dow do Postgres)", () => {
    expect(weekdayLabel(0)).toBe("Domingo");
    expect(weekdayLabel(1)).toBe("Segunda-feira");
    expect(weekdayLabel(6)).toBe("Sábado");
    expect(new Date(2026, 10, 16).getDay()).toBe(1); // 16/11/2026 é segunda-feira
  });

  it("a ordem de exibição começa na segunda e termina no domingo", () => {
    expect(WEEKDAY_ORDER).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("recusa dia fora de 0 a 6", () => {
    expect(() => weekdayLabel(7)).toThrow(RangeError);
    expect(() => weekdayLabel(-1)).toThrow(RangeError);
    expect(() => weekdayLabel(1.5)).toThrow(RangeError);
  });
});
