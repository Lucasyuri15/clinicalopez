import { describe, expect, it } from "vitest";

import { dayHeading, shortDate, weekHeading } from "./headings";

describe("títulos da agenda", () => {
  it("dayHeading: dia da semana por extenso e a data completa", () => {
    expect(dayHeading("2026-11-23")).toBe("Segunda-feira, 23/11/2026");
    expect(dayHeading("2026-11-22")).toBe("Domingo, 22/11/2026");
  });

  it("weekHeading: da segunda ao domingo da semana (inclusive virando o ano)", () => {
    expect(weekHeading("2026-11-25")).toBe("23/11/2026 a 29/11/2026");
    expect(weekHeading("2026-12-31")).toBe("28/12/2026 a 03/01/2027");
  });

  it("shortDate: dia/mês", () => {
    expect(shortDate("2026-11-03")).toBe("03/11");
  });

  it("recusa data que não existe", () => {
    expect(() => dayHeading("2026-02-30")).toThrow(RangeError);
    expect(() => weekHeading("amanhã")).toThrow(RangeError);
  });
});
