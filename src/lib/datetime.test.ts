import { describe, expect, test } from "vitest";
import {
  addDaysToDate,
  formatDateBR,
  formatDateTimeBR,
  formatTimeBR,
  isRealDate,
  todayBR,
  zonedToUtc,
} from "./datetime";

describe("todayBR (data de hoje em Brasília, AAAA-MM-DD)", () => {
  test("usa o fuso de Brasília, não o UTC", () => {
    // 02:00 UTC de 18/11 ainda é 23:00 de 17/11 em Brasília
    expect(todayBR(new Date("2026-11-18T02:00:00Z"))).toBe("2026-11-17");
    expect(todayBR(new Date("2026-11-18T03:00:00Z"))).toBe("2026-11-18");
    expect(todayBR(new Date("2026-11-18T14:00:00Z"))).toBe("2026-11-18");
  });

  test("completa mês e dia com zero", () => {
    expect(todayBR(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
  });
});

// O Brasil não tem horário de verão desde 2019: America/Sao_Paulo = UTC-3.
describe("datetime (America/Sao_Paulo)", () => {
  test("converte um instante UTC para data e hora de Brasília", () => {
    const utc = "2026-11-04T17:30:00Z";
    expect(formatDateBR(utc)).toBe("04/11/2026");
    expect(formatTimeBR(utc)).toBe("14:30");
    expect(formatDateTimeBR(utc)).toBe("04/11/2026 14:30");
  });

  test("aceita objetos Date", () => {
    expect(formatDateTimeBR(new Date("2026-11-04T17:30:00Z"))).toBe(
      "04/11/2026 14:30",
    );
  });

  test("a data local volta um dia quando o UTC já virou o dia", () => {
    // 02:30 UTC de 05/11 ainda é 23:30 de 04/11 em Brasília
    expect(formatDateTimeBR("2026-11-05T02:30:00Z")).toBe("04/11/2026 23:30");
  });

  test("meia-noite local é 03:00 UTC", () => {
    expect(formatDateTimeBR("2026-11-04T03:00:00Z")).toBe("04/11/2026 00:00");
  });

  test("virada de ano respeita o fuso", () => {
    expect(formatDateTimeBR("2027-01-01T02:59:00Z")).toBe("31/12/2026 23:59");
  });

  test("aceita offset explícito e converte para Brasília", () => {
    expect(formatDateTimeBR("2026-11-04T14:30:00-03:00")).toBe(
      "04/11/2026 14:30",
    );
    // 02:30 em UTC+9 do dia 05 = 17:30 UTC do dia 04
    expect(formatDateTimeBR("2026-11-05T02:30:00+09:00")).toBe(
      "04/11/2026 14:30",
    );
  });

  test("rejeita texto sem fuso, que dependeria da máquina que executa", () => {
    // "2026-11-04" seria lido como UTC (um dia a menos em Brasília) e
    // "2026-11-04T10:00:00" no fuso local do servidor/navegador.
    expect(() => formatDateBR("2026-11-04")).toThrow(RangeError);
    expect(() => formatDateTimeBR("2026-11-04T10:00:00")).toThrow(RangeError);
    expect(() => formatTimeBR("2026-11-04T10:00")).toThrow(RangeError);
  });

  test("rejeita datas inválidas", () => {
    expect(() => formatDateBR("não é data")).toThrow(RangeError);
    expect(() => formatTimeBR(new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe("isRealDate e addDaysToDate (datas de calendário, sem fuso)", () => {
  test.each([
    ["2026-12-24", true],
    ["2028-02-29", true], // ano bissexto
    ["2026-02-29", false],
    ["2026-02-30", false],
    ["2026-13-01", false],
    ["2026-00-10", false],
    ["2026-1-1", false],
    ["26-01-01", false],
    ["2026-01-01T00:00", false],
    ["", false],
  ])("isRealDate(%j) = %s", (text, expected) => {
    expect(isRealDate(text)).toBe(expected);
  });

  test("soma dias respeitando fim de mês, de ano e ano bissexto", () => {
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToDate("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDaysToDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToDate("2026-11-17", 0)).toBe("2026-11-17");
    expect(addDaysToDate("2026-01-01", 365)).toBe("2027-01-01");
  });

  test("recusa data inexistente", () => {
    expect(() => addDaysToDate("2026-02-30", 1)).toThrow(RangeError);
  });

  test("não devolve ano de 5 dígitos nem negativo (estoura em vez de gerar uma data inválida)", () => {
    expect(() => addDaysToDate("9999-12-31", 1)).toThrow(RangeError);
    expect(() => addDaysToDate("0000-01-01", -1)).toThrow(RangeError);
    expect(addDaysToDate("9999-12-30", 1)).toBe("9999-12-31");
  });
});

describe("zonedToUtc (horário de parede de Brasília para UTC)", () => {
  test("hoje (UTC-3): 08:00 em Brasília é 11:00 UTC", () => {
    expect(zonedToUtc("2026-12-24", "08:00").toISOString()).toBe("2026-12-24T11:00:00.000Z");
    expect(zonedToUtc("2026-01-01", "00:00").toISOString()).toBe("2026-01-01T03:00:00.000Z");
  });

  test("a virada do dia local cai no dia seguinte em UTC", () => {
    expect(zonedToUtc("2026-12-31", "22:00").toISOString()).toBe("2027-01-01T01:00:00.000Z");
  });

  test("não usa deslocamento fixo: em horário de verão antigo (UTC-2) o resultado muda", () => {
    expect(zonedToUtc("2018-11-10", "08:00").toISOString()).toBe("2018-11-10T10:00:00.000Z");
    expect(zonedToUtc("2018-12-25", "08:00").toISOString()).toBe("2018-12-25T10:00:00.000Z");
    expect(zonedToUtc("2018-10-01", "08:00").toISOString()).toBe("2018-10-01T11:00:00.000Z"); // antes do verão
  });

  test("hora que NÃO existiu (início do horário de verão de 2018: 00:00 pulou para 01:00) resolve para a frente", () => {
    expect(zonedToUtc("2018-11-04", "00:30").toISOString()).toBe("2018-11-04T03:30:00.000Z");
  });

  test("hora que existiu DUAS vezes (fim do verão em 2019-02-17) resolve para a primeira", () => {
    expect(zonedToUtc("2019-02-16", "23:30").toISOString()).toBe("2019-02-17T01:30:00.000Z");
  });

  test("devolve a mesma hora de parede quando formatada de volta em Brasília", () => {
    for (const [date, time] of [
      ["2026-03-15", "12:45"],
      ["2026-07-01", "23:55"],
      ["2018-12-01", "09:10"],
    ] as const) {
      expect(formatDateTimeBR(zonedToUtc(date, time))).toBe(
        `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)} ${time}`,
      );
    }
  });

  test("ano de dois dígitos (erro de digitação como 0026) não vira uma data de 1900", () => {
    expect(zonedToUtc("0026-12-24", "08:00").getUTCFullYear()).toBe(26);
  });

  test.each([
    ["2026-02-30", "08:00"],
    ["2026-12-24", "8:00"],
    ["2026-12-24", "25:00"],
    ["2026-12-24", "24:00"], // 24:00 não é horário de parede: use 00:00 do dia seguinte
    ["", "08:00"],
    ["24/12/2026", "08:00"],
  ])("recusa %j %j", (date, time) => {
    expect(() => zonedToUtc(date, time)).toThrow(RangeError);
  });
});
