import { describe, expect, it } from "vitest";

import { describeTimeOff } from "./format";

const d = (iso: string) => new Date(iso);

describe("describeTimeOff (horário de Brasília)", () => {
  it("vários dias inteiros: mostra o primeiro e o ÚLTIMO dia (o fim é a meia-noite depois dele)", () => {
    expect(describeTimeOff(d("2026-12-24T03:00:00Z"), d("2026-12-27T03:00:00Z"))).toBe(
      "24/12/2026 a 26/12/2026 (dia inteiro)",
    );
  });

  it("um dia inteiro só", () => {
    expect(describeTimeOff(d("2026-12-24T03:00:00Z"), d("2026-12-25T03:00:00Z"))).toBe("24/12/2026 (dia inteiro)");
  });

  it("bloqueio parcial no mesmo dia", () => {
    expect(describeTimeOff(d("2026-12-24T17:00:00Z"), d("2026-12-24T21:30:00Z"))).toBe("24/12/2026 das 14:00 às 18:30");
  });

  it("bloqueio parcial que atravessa dias", () => {
    expect(describeTimeOff(d("2026-12-24T21:00:00Z"), d("2026-12-26T11:00:00Z"))).toBe(
      "24/12/2026 18:00 até 26/12/2026 08:00",
    );
  });

  it("começa à meia-noite mas não termina nela: é parcial", () => {
    expect(describeTimeOff(d("2026-12-24T03:00:00Z"), d("2026-12-24T15:00:00Z"))).toBe("24/12/2026 das 00:00 às 12:00");
  });

  it("a virada do dia respeita o fuso: 23:30 em Brasília é 02:30 UTC do dia seguinte, e terminar à meia-noite atravessa a virada", () => {
    expect(describeTimeOff(d("2026-12-25T02:30:00Z"), d("2026-12-25T03:00:00Z"))).toBe(
      "24/12/2026 23:30 até 25/12/2026 00:00",
    );
  });
});
