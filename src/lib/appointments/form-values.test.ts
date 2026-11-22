import { describe, expect, it } from "vitest";

import { slotFormValues } from "./form-values";

describe("slotFormValues (preenche a remarcação em horário de Brasília)", () => {
  it("devolve data, hora e duração como texto de formulário", () => {
    const values = slotFormValues({
      startsAt: new Date("2026-11-23T12:00:00Z"), // 09:00 em Brasília
      endsAt: new Date("2026-11-23T12:50:00Z"),
    });
    expect(values).toEqual({ date: "2026-11-23", startTime: "09:00", durationMinutes: "50" });
  });

  it("usa o dia de Brasília: 22h locais (01h UTC) continuam no mesmo dia", () => {
    const values = slotFormValues({
      startsAt: new Date("2026-11-24T01:00:00Z"),
      endsAt: new Date("2026-11-24T01:30:00Z"),
    });
    expect(values).toEqual({ date: "2026-11-23", startTime: "22:00", durationMinutes: "30" });
  });

  it("completa com zero hora e minuto", () => {
    const values = slotFormValues({
      startsAt: new Date("2026-11-23T11:05:00Z"), // 08:05
      endsAt: new Date("2026-11-23T12:05:00Z"),
    });
    expect(values.startTime).toBe("08:05");
    expect(values.durationMinutes).toBe("60");
  });

  it("a duração segue o relógio real (dia de horário de verão com 25 h não muda a duração)", () => {
    // 2018-11-04: o Brasil adiantou o relógio à meia-noite; 23:00 → 01:00 local são 1 h reais.
    const values = slotFormValues({
      startsAt: new Date("2018-11-04T02:30:00Z"),
      endsAt: new Date("2018-11-04T03:30:00Z"),
    });
    expect(values.durationMinutes).toBe("60");
  });
});
