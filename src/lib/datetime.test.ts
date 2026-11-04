import { describe, expect, test } from "vitest";
import { formatDateBR, formatDateTimeBR, formatTimeBR } from "./datetime";

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

  test("não depende do fuso da máquina que executa", () => {
    const previous = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
      expect(formatDateTimeBR("2026-11-04T17:30:00Z")).toBe("04/11/2026 14:30");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  test("rejeita datas inválidas", () => {
    expect(() => formatDateBR("não é data")).toThrow(RangeError);
    expect(() => formatTimeBR(new Date(Number.NaN))).toThrow(RangeError);
  });
});
