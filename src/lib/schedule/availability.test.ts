import { describe, expect, it } from "vitest";

import { zonedToUtc } from "@/lib/datetime";

import { checkSlot } from "./availability";
import type { WorkRange } from "./week";

/** Segunda (1): 08–12 e 14–18; sábado (6): 08–12. */
const GRID: WorkRange[] = [
  { weekday: 1, start: 8 * 60, end: 12 * 60 },
  { weekday: 1, start: 14 * 60, end: 18 * 60 },
  { weekday: 6, start: 8 * 60, end: 12 * 60 },
];

const MONDAY = "2026-11-23"; // segunda-feira
const SATURDAY = "2026-11-28";
const at = (date: string, time: string) => zonedToUtc(date, time);
const slot = (date: string, from: string, to: string, over: Partial<Parameters<typeof checkSlot>[0]> = {}) =>
  checkSlot({ startsAt: at(date, from), endsAt: at(date, to), ranges: GRID, timeOff: [], ...over });

describe("checkSlot: cabe na grade", () => {
  it("aceita um horário dentro de uma faixa", () => {
    expect(slot(MONDAY, "09:00", "09:50")).toEqual({ ok: true });
    expect(slot(SATURDAY, "10:00", "11:00")).toEqual({ ok: true });
  });

  it("a faixa é meio-aberta: pode começar na abertura e terminar exatamente no fechamento", () => {
    expect(slot(MONDAY, "08:00", "12:00")).toEqual({ ok: true });
    expect(slot(MONDAY, "14:00", "18:00")).toEqual({ ok: true });
  });

  it.each([
    ["começa antes da abertura", "07:55", "08:30"],
    ["termina depois do fechamento", "17:30", "18:05"],
    ["cai inteiro no vão do almoço", "12:00", "13:00"],
    ["atravessa o vão do almoço", "11:30", "14:30"],
    ["começa numa faixa e termina na outra", "11:00", "15:00"],
    ["fica depois do expediente", "18:00", "18:30"],
  ])("recusa o que %s (outside-grid)", (_name, from, to) => {
    expect(slot(MONDAY, from, to)).toEqual({ ok: false, reason: "outside-grid" });
  });

  it("recusa um dia da semana sem faixa (domingo e terça)", () => {
    expect(slot("2026-11-22", "09:00", "10:00")).toEqual({ ok: false, reason: "outside-grid" }); // domingo
    expect(slot("2026-11-24", "09:00", "10:00")).toEqual({ ok: false, reason: "outside-grid" }); // terça
  });

  it("recusa quando não há nenhuma faixa cadastrada", () => {
    expect(slot(MONDAY, "09:00", "10:00", { ranges: [] })).toEqual({ ok: false, reason: "outside-grid" });
  });

  it("faixas que apenas se encostam (08–12 e 12–14) valem como uma só; o vão não", () => {
    const touching: WorkRange[] = [
      { weekday: 1, start: 8 * 60, end: 12 * 60 },
      { weekday: 1, start: 12 * 60, end: 14 * 60 },
    ];
    expect(slot(MONDAY, "11:30", "12:30", { ranges: touching })).toEqual({ ok: true });
    expect(slot(MONDAY, "11:30", "14:30", { ranges: touching })).toEqual({ ok: false, reason: "outside-grid" });
    expect(slot(MONDAY, "11:30", "12:30")).toEqual({ ok: false, reason: "outside-grid" }); // com vão (GRID)
  });

  it("não depende da ordem das faixas recebidas", () => {
    const shuffled = [...GRID].reverse();
    expect(slot(MONDAY, "15:00", "16:00", { ranges: shuffled })).toEqual({ ok: true });
    expect(slot(MONDAY, "12:00", "13:00", { ranges: shuffled })).toEqual({ ok: false, reason: "outside-grid" });
  });
});

describe("checkSlot: horário inválido", () => {
  it("recusa data inválida e fim que não é depois do início", () => {
    expect(checkSlot({ startsAt: new Date("x"), endsAt: at(MONDAY, "10:00"), ranges: GRID, timeOff: [] })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(checkSlot({ startsAt: at(MONDAY, "10:00"), endsAt: new Date("x"), ranges: GRID, timeOff: [] })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(slot(MONDAY, "10:00", "10:00")).toEqual({ ok: false, reason: "invalid" });
    expect(slot(MONDAY, "10:30", "10:00")).toEqual({ ok: false, reason: "invalid" });
  });

  it("recusa milissegundos (o banco exige instantes redondos; `wallParts` descartaria a fração)", () => {
    const withMs = checkSlot({
      startsAt: new Date(at(MONDAY, "09:00").getTime() + 500),
      endsAt: at(MONDAY, "10:00"),
      ranges: GRID,
      timeOff: [],
    });
    expect(withMs).toEqual({ ok: false, reason: "invalid" });
    const endWithMs = checkSlot({
      startsAt: at(MONDAY, "09:00"),
      endsAt: new Date(at(MONDAY, "10:00").getTime() + 1),
      ranges: GRID,
      timeOff: [],
    });
    expect(endWithMs).toEqual({ ok: false, reason: "invalid" });
  });

  it("recusa minutos que não são de 5 em 5 e segundos diferentes de zero", () => {
    expect(slot(MONDAY, "09:03", "10:00")).toEqual({ ok: false, reason: "invalid" });
    expect(slot(MONDAY, "09:00", "10:02")).toEqual({ ok: false, reason: "invalid" });
    const withSeconds = checkSlot({
      startsAt: new Date(at(MONDAY, "09:00").getTime() + 30_000),
      endsAt: at(MONDAY, "10:00"),
      ranges: GRID,
      timeOff: [],
    });
    expect(withSeconds).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("checkSlot: virada da meia-noite", () => {
  const NIGHT: WorkRange[] = [{ weekday: 1, start: 18 * 60, end: 24 * 60 }];

  it("recusa o que atravessa a meia-noite", () => {
    const result = checkSlot({
      startsAt: at(MONDAY, "23:00"),
      endsAt: at("2026-11-24", "00:30"),
      ranges: NIGHT,
      timeOff: [],
    });
    expect(result).toEqual({ ok: false, reason: "crosses-midnight" });
  });

  it("aceita terminar exatamente à meia-noite (24:00 do mesmo dia)", () => {
    const result = checkSlot({
      startsAt: at(MONDAY, "23:00"),
      endsAt: at("2026-11-24", "00:00"),
      ranges: NIGHT,
      timeOff: [],
    });
    expect(result).toEqual({ ok: true });
  });

  it("recusa mais de um dia de duração", () => {
    const result = checkSlot({
      startsAt: at(MONDAY, "09:00"),
      endsAt: at("2026-11-25", "09:00"),
      ranges: GRID,
      timeOff: [],
    });
    expect(result).toEqual({ ok: false, reason: "crosses-midnight" });
  });
});

describe("checkSlot: folgas e bloqueios", () => {
  const off = (date: string, from: string, to: string) => ({ startsAt: at(date, from), endsAt: at(date, to) });

  it("recusa o que se sobrepõe a uma folga (time-off), mesmo parcialmente", () => {
    expect(slot(MONDAY, "09:00", "10:00", { timeOff: [off(MONDAY, "09:30", "10:30")] })).toEqual({ ok: false, reason: "time-off" });
    expect(slot(MONDAY, "09:00", "10:00", { timeOff: [off(MONDAY, "08:00", "09:05")] })).toEqual({ ok: false, reason: "time-off" });
    expect(slot(MONDAY, "09:00", "10:00", { timeOff: [off(MONDAY, "09:10", "09:20")] })).toEqual({ ok: false, reason: "time-off" });
    expect(slot(MONDAY, "09:10", "09:20", { timeOff: [off(MONDAY, "08:00", "12:00")] })).toEqual({ ok: false, reason: "time-off" });
  });

  it("a folga é meio-aberta: terminar quando ela começa, ou começar quando ela termina, vale", () => {
    expect(slot(MONDAY, "09:00", "10:00", { timeOff: [off(MONDAY, "10:00", "11:00")] })).toEqual({ ok: true });
    expect(slot(MONDAY, "10:00", "11:00", { timeOff: [off(MONDAY, "09:00", "10:00")] })).toEqual({ ok: true });
  });

  it("uma folga de vários dias bloqueia o horário no meio dela", () => {
    const vacation = { startsAt: at("2026-11-20", "00:00"), endsAt: at("2026-11-30", "00:00") };
    expect(slot(MONDAY, "09:00", "10:00", { timeOff: [vacation] })).toEqual({ ok: false, reason: "time-off" });
  });

  it("folga em outro dia não atrapalha", () => {
    expect(slot(MONDAY, "09:00", "10:00", { timeOff: [off("2026-11-24", "09:00", "10:00")] })).toEqual({ ok: true });
  });

  it("ordem das razões: fora da grade vem antes de folga", () => {
    expect(slot(MONDAY, "12:00", "13:00", { timeOff: [off(MONDAY, "12:00", "13:00")] })).toEqual({
      ok: false,
      reason: "outside-grid",
    });
  });
});

describe("checkSlot: horário de verão antigo do Brasil (sem deslocamento fixo de 3 h)", () => {
  it("2018-11-04 (domingo, começo do horário de verão): compara o relógio de parede, não a duração", () => {
    const sunday: WorkRange[] = [{ weekday: 0, start: 8 * 60, end: 12 * 60 }];
    const result = checkSlot({
      startsAt: at("2018-11-04", "09:00"),
      endsAt: at("2018-11-04", "10:00"),
      ranges: sunday,
      timeOff: [],
    });
    expect(result).toEqual({ ok: true });
  });

  it("2018-01-15 (segunda, em horário de verão, UTC-2) e 2018-07-16 (UTC-3) valem igual", () => {
    expect(slot("2018-01-15", "09:00", "10:00")).toEqual({ ok: true });
    expect(slot("2018-07-16", "09:00", "10:00")).toEqual({ ok: true });
    expect(slot("2018-01-15", "12:00", "13:00")).toEqual({ ok: false, reason: "outside-grid" });
  });

  it("2019-02-17: a hora repetida (23:30 duas vezes) não vira um horário válido de duração zero", () => {
    // 23:30 de 16/02 (UTC-2) = 01:30Z e o mesmo relógio de novo (UTC-3) = 02:30Z
    const saturdayNight: WorkRange[] = [{ weekday: 6, start: 20 * 60, end: 24 * 60 }];
    const result = checkSlot({
      startsAt: new Date("2019-02-17T01:30:00Z"),
      endsAt: new Date("2019-02-17T02:30:00Z"),
      ranges: saturdayNight,
      timeOff: [],
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });
});
