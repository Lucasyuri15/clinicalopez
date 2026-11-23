import { describe, expect, it } from "vitest";

import { addDaysToDate, wallParts, zonedToUtc } from "@/lib/datetime";

import {
  classifyOccurrence,
  generateOccurrences,
  SERIES_MAX_SPAN_DAYS,
  seriesProgress,
  shiftSeriesFrom,
  type SeriesMember,
} from "./series";

const dates = (list: { date: string }[]) => list.map((item) => item.date);

describe("generateOccurrences", () => {
  it("série semanal: um dia da semana, mesma hora de parede", () => {
    // 2026-11-24 é terça-feira.
    const list = generateOccurrences({
      firstDate: "2026-11-24",
      weekdays: [2],
      startTime: "14:00",
      durationMinutes: 50,
      count: 3,
    });
    expect(dates(list)).toEqual(["2026-11-24", "2026-12-01", "2026-12-08"]);
    expect(list[0]?.startsAt).toEqual(zonedToUtc("2026-11-24", "14:00"));
    expect(list[0]?.endsAt.getTime()).toBe((list[0]?.startsAt.getTime() ?? 0) + 50 * 60_000);
  });

  it("2x por semana: terça e quinta, em ordem de data", () => {
    const list = generateOccurrences({
      firstDate: "2026-11-24",
      weekdays: [4, 2],
      startTime: "09:30",
      durationMinutes: 45,
      count: 5,
    });
    expect(dates(list)).toEqual(["2026-11-24", "2026-11-26", "2026-12-01", "2026-12-03", "2026-12-08"]);
  });

  it("a data inicial não precisa cair num dos dias marcados: começa no primeiro dia marcado a partir dela", () => {
    // 2026-11-23 é segunda-feira; a série é de terças.
    const list = generateOccurrences({
      firstDate: "2026-11-23",
      weekdays: [2],
      startTime: "10:00",
      durationMinutes: 30,
      count: 2,
    });
    expect(dates(list)).toEqual(["2026-11-24", "2026-12-01"]);
  });

  it("dias repetidos ou inválidos são ignorados", () => {
    const list = generateOccurrences({
      firstDate: "2026-11-24",
      weekdays: [2, 2, 7, -1, 1.5],
      startTime: "10:00",
      durationMinutes: 30,
      count: 2,
    });
    expect(dates(list)).toEqual(["2026-11-24", "2026-12-01"]);
  });

  it("sem dia da semana válido não há sessões", () => {
    expect(
      generateOccurrences({ firstDate: "2026-11-24", weekdays: [], startTime: "10:00", durationMinutes: 30, count: 3 }),
    ).toEqual([]);
    expect(
      generateOccurrences({ firstDate: "2026-11-24", weekdays: [9], startTime: "10:00", durationMinutes: 30, count: 3 }),
    ).toEqual([]);
  });

  it("vira o mês e o ano", () => {
    const list = generateOccurrences({
      firstDate: "2026-12-29",
      weekdays: [2],
      startTime: "08:00",
      durationMinutes: 60,
      count: 3,
    });
    expect(dates(list)).toEqual(["2026-12-29", "2027-01-05", "2027-01-12"]);
  });

  it("mantém a hora de parede quando o fuso muda (horário de verão que existiu até 2019)", () => {
    // Em 2019-02-12 ainda era horário de verão (-02:00); em 2019-02-19, não (-03:00).
    const list = generateOccurrences({
      firstDate: "2019-02-12",
      weekdays: [2],
      startTime: "14:00",
      durationMinutes: 50,
      count: 2,
    });
    expect(list).toHaveLength(2);
    for (const item of list) {
      const wall = wallParts(item.startsAt);
      expect(wall.date).toBe(item.date);
      expect(wall.minute).toBe(14 * 60);
    }
    const [first, second] = list;
    // Em UTC os dois não distam exatamente 7 × 24 h.
    expect((second?.startsAt.getTime() ?? 0) - (first?.startsAt.getTime() ?? 0)).not.toBe(7 * 24 * 3_600_000);
  });

  it("devolve só as sessões que cabem em 1 ano (quem chama compara com o pedido)", () => {
    const list = generateOccurrences({
      firstDate: "2026-11-24",
      weekdays: [2],
      startTime: "10:00",
      durationMinutes: 30,
      count: 60,
    });
    expect(list).toHaveLength(53);
    expect(list.at(-1)?.date).toBe(addDaysToDate("2026-11-24", 52 * 7));
    expect((list.at(-1)?.date ?? "") <= addDaysToDate("2026-11-24", SERIES_MAX_SPAN_DAYS)).toBe(true);
  });

  it("count zero ou negativo não gera nada", () => {
    expect(
      generateOccurrences({ firstDate: "2026-11-24", weekdays: [2], startTime: "10:00", durationMinutes: 30, count: 0 }),
    ).toEqual([]);
  });
});

describe("classifyOccurrence", () => {
  // Grade: terça (2) das 08:00 às 12:00 e das 14:00 às 18:00 (minutos desde a meia-noite).
  const ranges = [
    { weekday: 2, start: 8 * 60, end: 12 * 60 },
    { weekday: 2, start: 14 * 60, end: 18 * 60 },
  ];
  const now = new Date("2026-11-20T12:00:00Z");
  const slot = (date: string, time: string, minutes = 50) => {
    const startsAt = zonedToUtc(date, time);
    return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) };
  };
  const base = { now, ranges, timeOff: [], busyProfessional: [], busyPatient: [] };

  it("cabe: dentro da grade, no futuro e sem colisão", () => {
    expect(classifyOccurrence({ ...base, occurrence: slot("2026-11-24", "14:00") })).toEqual({ ok: true });
  });

  it("passado vem antes de tudo", () => {
    expect(classifyOccurrence({ ...base, occurrence: slot("2026-11-17", "14:00") })).toEqual({ ok: false, reason: "past" });
  });

  it("fora da grade (dia sem atendimento e vão do almoço)", () => {
    expect(classifyOccurrence({ ...base, occurrence: slot("2026-11-25", "14:00") })).toEqual({
      ok: false,
      reason: "outside-grid",
    });
    expect(classifyOccurrence({ ...base, occurrence: slot("2026-11-24", "12:30") })).toEqual({
      ok: false,
      reason: "outside-grid",
    });
  });

  it("folga ou bloqueio", () => {
    const timeOff = [{ startsAt: zonedToUtc("2026-11-24", "00:00"), endsAt: zonedToUtc("2026-11-25", "00:00") }];
    expect(classifyOccurrence({ ...base, timeOff, occurrence: slot("2026-11-24", "14:00") })).toEqual({
      ok: false,
      reason: "time-off",
    });
  });

  it("horário inválido (fora do passo de 5 minutos)", () => {
    expect(classifyOccurrence({ ...base, occurrence: slot("2026-11-24", "14:03") })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("colisão com outro atendimento do profissional ou do paciente", () => {
    const busy = [slot("2026-11-24", "14:30")];
    expect(classifyOccurrence({ ...base, busyProfessional: busy, occurrence: slot("2026-11-24", "14:00") })).toEqual({
      ok: false,
      reason: "conflict-professional",
    });
    expect(classifyOccurrence({ ...base, busyPatient: busy, occurrence: slot("2026-11-24", "14:00") })).toEqual({
      ok: false,
      reason: "conflict-patient",
    });
  });

  it("os intervalos são meio-abertos: encostar não colide", () => {
    // 14:00–14:50 e o outro atendimento começa às 14:50.
    const busy = [slot("2026-11-24", "14:50")];
    expect(classifyOccurrence({ ...base, busyProfessional: busy, occurrence: slot("2026-11-24", "14:00") })).toEqual({
      ok: true,
    });
  });

  it("fim em 2101 ou depois é inválido (o banco recusa com 23514): vale antes da grade", () => {
    // 2101-01-02 é uma sexta-feira; mesmo com grade, o limite do banco manda.
    const friday = [{ weekday: 5, start: 8 * 60, end: 18 * 60 }];
    const inside = { startsAt: zonedToUtc("2100-12-31", "09:00"), endsAt: zonedToUtc("2100-12-31", "09:50") };
    const outside = { startsAt: zonedToUtc("2101-01-02", "09:00"), endsAt: zonedToUtc("2101-01-02", "09:50") };
    const far = new Date("2090-01-01T00:00:00Z");
    expect(classifyOccurrence({ ...base, now: far, ranges: [{ weekday: 5, start: 8 * 60, end: 18 * 60 }, ...friday], occurrence: outside })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(classifyOccurrence({ ...base, now: far, ranges: friday, occurrence: inside }).ok).toBe(true);
  });

  it("ordem das razões: a grade vale antes da colisão, e a do profissional antes da do paciente", () => {
    const busy = [slot("2026-11-25", "14:00")];
    expect(classifyOccurrence({ ...base, busyProfessional: busy, occurrence: slot("2026-11-25", "14:00") })).toEqual({
      ok: false,
      reason: "outside-grid",
    });
    const both = [slot("2026-11-24", "14:00")];
    expect(
      classifyOccurrence({ ...base, busyProfessional: both, busyPatient: both, occurrence: slot("2026-11-24", "14:00") }),
    ).toEqual({ ok: false, reason: "conflict-professional" });
  });
});

describe("shiftSeriesFrom", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const member = (id: string, date: string, time = "14:00", status: SeriesMember["status"] = "scheduled"): SeriesMember => {
    const startsAt = zonedToUtc(date, time);
    return { id, startsAt, endsAt: new Date(startsAt.getTime() + 50 * 60_000), status };
  };
  // Terças e quintas: 24/11 (ter), 26/11 (qui), 01/12 (ter), 03/12 (qui).
  const members = [
    member("a", "2026-11-24"),
    member("b", "2026-11-26"),
    member("c", "2026-12-01"),
    member("d", "2026-12-03"),
  ];
  const dateOf = (instant: Date) => wallParts(instant).date;

  /** Aplica os movimentos NA ORDEM devolvida e garante que nenhum cai num horário ainda ocupado. */
  function applyInOrder(all: SeriesMember[], moves: ReturnType<typeof shiftSeriesFrom>) {
    const occupied = new Set(all.map((item) => item.startsAt.getTime()));
    const byId = new Map(all.map((item) => [item.id, item]));
    for (const move of moves) {
      const current = byId.get(move.id);
      expect(current).toBeDefined();
      occupied.delete(current!.startsAt.getTime());
      expect(occupied.has(move.to.startsAt.getTime())).toBe(false); // colisão com uma irmã ainda não movida
      occupied.add(move.to.startsAt.getTime());
    }
    return occupied;
  }

  it("desloca esta e as seguintes pelo mesmo número de dias, com o novo horário", () => {
    // Da quinta 26/11 para a sexta 27/11 (+1 dia), às 15:00 e com 40 min.
    const moves = shiftSeriesFrom({
      members,
      fromId: "b",
      newDate: "2026-11-27",
      newTime: "15:00",
      newDurationMinutes: 40,
      now,
    });
    expect(moves.map((move) => [move.id, dateOf(move.to.startsAt)])).toEqual([
      ["d", "2026-12-04"],
      ["c", "2026-12-02"],
      ["b", "2026-11-27"],
    ]);
    for (const move of moves) {
      expect(wallParts(move.to.startsAt).minute).toBe(15 * 60);
      expect(move.to.endsAt.getTime() - move.to.startsAt.getTime()).toBe(40 * 60_000);
    }
  });

  it("não mexe nas anteriores nem nas que não estão abertas", () => {
    const mixed = [
      member("a", "2026-11-24", "14:00", "done"),
      member("b", "2026-11-26"),
      member("c", "2026-12-01", "14:00", "cancelled"),
      member("d", "2026-12-03", "14:00", "no_show"),
      member("e", "2026-12-08", "14:00", "confirmed"),
    ];
    const moves = shiftSeriesFrom({ members: mixed, fromId: "b", newDate: "2026-11-27", newTime: "14:00", newDurationMinutes: 50, now });
    expect(moves.map((move) => move.id).sort()).toEqual(["b", "e"]);
  });

  it("para a frente: aplica da última para a primeira (+2 dias não colide com a irmã)", () => {
    // Terça 24/11 passa a quinta 26/11 (+2): cai exatamente onde a irmã "b" está hoje.
    const moves = shiftSeriesFrom({ members, fromId: "a", newDate: "2026-11-26", newTime: "14:00", newDurationMinutes: 50, now });
    expect(moves.map((move) => move.id)).toEqual(["d", "c", "b", "a"]);
    applyInOrder(members, moves);
  });

  it("para trás: aplica da primeira para a última (-2 dias não colide com a irmã)", () => {
    // Série que começa na quinta 26/11 (sem a terça 24/11, que ocuparia o destino).
    const fromThursday = members.filter((item) => item.id !== "a");
    const moves = shiftSeriesFrom({ members: fromThursday, fromId: "b", newDate: "2026-11-24", newTime: "14:00", newDurationMinutes: 50, now });
    expect(moves.map((move) => [move.id, dateOf(move.to.startsAt)])).toEqual([
      ["b", "2026-11-24"],
      ["c", "2026-11-29"],
      ["d", "2026-12-01"],
    ]);
    applyInOrder(fromThursday, moves);
  });

  it("só trocar o horário no mesmo dia mantém as datas", () => {
    const moves = shiftSeriesFrom({ members, fromId: "a", newDate: "2026-11-24", newTime: "16:00", newDurationMinutes: 50, now });
    expect(moves.map((move) => dateOf(move.to.startsAt))).toEqual(["2026-11-24", "2026-11-26", "2026-12-01", "2026-12-03"]);
    for (const move of moves) expect(wallParts(move.to.startsAt).minute).toBe(16 * 60);
  });

  it("sessão que já está exatamente no destino não gera movimento", () => {
    const moves = shiftSeriesFrom({ members, fromId: "a", newDate: "2026-11-24", newTime: "14:00", newDurationMinutes: 50, now });
    expect(moves).toEqual([]);
  });

  it("sessão escolhida inexistente ou fechada não move nada", () => {
    expect(shiftSeriesFrom({ members, fromId: "x", newDate: "2026-11-27", newTime: "14:00", newDurationMinutes: 50, now })).toEqual([]);
    const closed = [member("a", "2026-11-24", "14:00", "done"), member("b", "2026-11-26")];
    expect(shiftSeriesFrom({ members: closed, fromId: "a", newDate: "2026-11-25", newTime: "14:00", newDurationMinutes: 50, now })).toEqual([]);
  });

  it("vira o mês: o deslocamento é em dias de calendário", () => {
    const edge = [member("a", "2026-12-29"), member("b", "2027-01-05")];
    const moves = shiftSeriesFrom({ members: edge, fromId: "a", newDate: "2026-12-31", newTime: "14:00", newDurationMinutes: 50, now });
    expect(moves.map((move) => [move.id, dateOf(move.to.startsAt)])).toEqual([
      ["b", "2027-01-07"],
      ["a", "2026-12-31"],
    ]);
  });
});

describe("seriesProgress", () => {
  const at = (day: number, status: SeriesMember["status"], id: string): SeriesMember => {
    const startsAt = new Date(Date.UTC(2026, 10, day, 17));
    return { id, startsAt, endsAt: new Date(startsAt.getTime() + 3_000_000), status };
  };
  const list = [
    at(3, "done", "s1"),
    at(10, "no_show", "s2"),
    at(17, "cancelled", "s3"),
    at(24, "scheduled", "s4"),
    at(30, "confirmed", "s5"),
  ];

  it("conta realizadas, faltas, restantes e canceladas; o total não inclui as canceladas", () => {
    expect(seriesProgress(list, "s4")).toEqual({ position: 3, total: 4, done: 1, noShow: 1, remaining: 2, cancelled: 1 });
  });

  it("a posição ignora as canceladas e vem em ordem de data, mesmo com a lista embaralhada", () => {
    expect(seriesProgress([...list].reverse(), "s5").position).toBe(4);
    expect(seriesProgress(list, "s1").position).toBe(1);
  });

  it("sessão cancelada não tem posição", () => {
    expect(seriesProgress(list, "s3").position).toBeNull();
  });
});
