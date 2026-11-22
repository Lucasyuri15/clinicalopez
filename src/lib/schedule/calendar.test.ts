import { describe, expect, it } from "vitest";

import { dayWindow, mondayOf, stepDate, weekDates, weekdayOf, weekWindow } from "./calendar";

const HOUR = 60 * 60 * 1000;
const hours = (window: { from: Date; to: Date }) => (window.to.getTime() - window.from.getTime()) / HOUR;

describe("weekdayOf (dia da semana de uma data de calendário, 0 = domingo)", () => {
  it("segue a convenção da grade de horários", () => {
    expect(weekdayOf("2026-11-22")).toBe(0); // domingo
    expect(weekdayOf("2026-11-23")).toBe(1); // segunda
    expect(weekdayOf("2026-11-28")).toBe(6); // sábado
  });

  it("recusa data que não existe", () => {
    expect(() => weekdayOf("2026-02-30")).toThrow(RangeError);
    expect(() => weekdayOf("amanhã")).toThrow(RangeError);
  });
});

describe("mondayOf (a semana vai de segunda a domingo)", () => {
  it("devolve a própria data numa segunda e recua nos outros dias", () => {
    expect(mondayOf("2026-11-23")).toBe("2026-11-23"); // segunda
    expect(mondayOf("2026-11-25")).toBe("2026-11-23"); // quarta
    expect(mondayOf("2026-11-28")).toBe("2026-11-23"); // sábado
  });

  it("o domingo pertence à semana que começou na segunda anterior", () => {
    expect(mondayOf("2026-11-29")).toBe("2026-11-23");
  });

  it("atravessa a virada de mês e de ano", () => {
    expect(mondayOf("2027-01-01")).toBe("2026-12-28"); // sexta
    expect(mondayOf("2026-12-01")).toBe("2026-11-30"); // terça
  });
});

describe("weekDates", () => {
  it("lista as 7 datas da semana, de segunda a domingo", () => {
    expect(weekDates("2026-11-26")).toEqual([
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-28",
      "2026-11-29",
    ]);
  });

  it("vale para qualquer dia da mesma semana", () => {
    expect(weekDates("2026-11-29")).toEqual(weekDates("2026-11-23"));
  });
});

describe("dayWindow e weekWindow (janela em UTC de um dia/semana de Brasília, meio-aberta)", () => {
  it("um dia comum vai de 03:00Z a 03:00Z do dia seguinte (UTC-3)", () => {
    const window = dayWindow("2026-11-23");
    expect(window.from.toISOString()).toBe("2026-11-23T03:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-11-24T03:00:00.000Z");
  });

  it("a semana vai da segunda 00:00 até a segunda seguinte 00:00", () => {
    const window = weekWindow("2026-11-26");
    expect(window.from.toISOString()).toBe("2026-11-23T03:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-11-30T03:00:00.000Z");
    expect(hours(window)).toBe(7 * 24);
  });

  it("usa o fuso de verdade: o dia em que o horário de verão começou (2018-11-04) teve 23 h", () => {
    expect(hours(dayWindow("2018-11-04"))).toBe(23);
  });

  it("e o dia anterior ao fim do horário de verão (2019-02-16) teve 25 h; o seguinte, 24 h", () => {
    expect(hours(dayWindow("2019-02-16"))).toBe(25);
    expect(hours(dayWindow("2019-02-17"))).toBe(24);
  });

  it("janelas de dias seguidos se encostam sem lacuna nem sobreposição", () => {
    for (const date of ["2026-11-23", "2018-11-03", "2018-11-04", "2019-02-15", "2019-02-16"]) {
      const next = dayWindow(stepDate(date, "day", 1));
      expect(dayWindow(date).to.getTime(), date).toBe(next.from.getTime());
    }
  });
});

describe("stepDate (anterior/próximo na visão atual)", () => {
  it("anda de 1 dia na visão de dia e de 7 na de semana", () => {
    expect(stepDate("2026-11-23", "day", 1)).toBe("2026-11-24");
    expect(stepDate("2026-11-23", "day", -1)).toBe("2026-11-22");
    expect(stepDate("2026-11-23", "week", 1)).toBe("2026-11-30");
    expect(stepDate("2026-11-23", "week", -1)).toBe("2026-11-16");
  });

  it("atravessa a virada de ano", () => {
    expect(stepDate("2026-12-31", "day", 1)).toBe("2027-01-01");
    expect(stepDate("2027-01-03", "week", -1)).toBe("2026-12-27");
  });
});
