import { describe, expect, it } from "vitest";

import { zonedToUtc } from "@/lib/datetime";

import { describePreference, matchesPreference, timeInputValue, type Preference } from "./match";

const any: Preference = { weekdays: [], startMinute: null, endMinute: null };

/** Terça-feira, 2026-11-24, em Brasília. */
function slot(time: string, minutes = 50, date = "2026-11-24") {
  const startsAt = zonedToUtc(date, time);
  return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) };
}

describe("matchesPreference", () => {
  it("sem dias e sem faixa, qualquer horário serve", () => {
    expect(matchesPreference(any, slot("07:00"))).toBe(true);
    expect(matchesPreference(any, slot("23:00", 30))).toBe(true);
  });

  it("dias: só serve se o dia da semana de Brasília estiver na lista", () => {
    const tuesdayAndThursday: Preference = { ...any, weekdays: [2, 4] };
    expect(matchesPreference(tuesdayAndThursday, slot("10:00"))).toBe(true); // terça
    expect(matchesPreference(tuesdayAndThursday, slot("10:00", 50, "2026-11-25"))).toBe(false); // quarta
  });

  it("o dia vale no relógio de Brasília, não em UTC", () => {
    // 22:00 de terça em Brasília já é quarta em UTC.
    const tuesday: Preference = { ...any, weekdays: [2] };
    expect(matchesPreference(tuesday, slot("22:00", 50))).toBe(true);
    const wednesday: Preference = { ...any, weekdays: [3] };
    expect(matchesPreference(wednesday, slot("22:00", 50))).toBe(false);
  });

  it("faixa: o atendimento inteiro precisa caber (início e fim inclusive)", () => {
    const afternoon: Preference = { ...any, startMinute: 14 * 60, endMinute: 18 * 60 };
    expect(matchesPreference(afternoon, slot("14:00", 60))).toBe(true);
    expect(matchesPreference(afternoon, slot("17:00", 60))).toBe(true); // termina às 18:00 em ponto
    expect(matchesPreference(afternoon, slot("17:10", 60))).toBe(false); // passa do fim
    expect(matchesPreference(afternoon, slot("13:55", 60))).toBe(false); // começa antes
  });

  it("faixa até 24:00 aceita um atendimento que termina à meia-noite", () => {
    const evening: Preference = { ...any, startMinute: 18 * 60, endMinute: 1440 };
    expect(matchesPreference(evening, slot("23:00", 60))).toBe(true);
    expect(matchesPreference(evening, slot("23:30", 60))).toBe(false); // atravessaria a meia-noite
  });

  it("dias e faixa juntos: os dois precisam bater", () => {
    const pref: Preference = { weekdays: [2], startMinute: 14 * 60, endMinute: 18 * 60 };
    expect(matchesPreference(pref, slot("15:00"))).toBe(true);
    expect(matchesPreference(pref, slot("09:00"))).toBe(false);
    expect(matchesPreference(pref, slot("15:00", 50, "2026-11-25"))).toBe(false);
  });
});

describe("describePreference", () => {
  it("sem preferência", () => {
    expect(describePreference(any)).toBe("Qualquer dia e horário");
  });

  it("dias em ordem de segunda a domingo, com 'e' antes do último", () => {
    expect(describePreference({ ...any, weekdays: [3] })).toBe("Qua, qualquer horário");
    expect(describePreference({ ...any, weekdays: [3, 1] })).toBe("Seg e qua, qualquer horário");
    expect(describePreference({ ...any, weekdays: [0, 5, 1] })).toBe("Seg, sex e dom, qualquer horário");
  });

  it("faixa de horário", () => {
    expect(describePreference({ ...any, startMinute: 840, endMinute: 1080 })).toBe("Qualquer dia, 14:00–18:00");
    expect(describePreference({ weekdays: [1, 3], startMinute: 480, endMinute: 720 })).toBe("Seg e qua, 08:00–12:00");
  });
});

describe("timeInputValue", () => {
  it("o valor do campo de hora: vazio, HH:MM e a meia-noite como 00:00", () => {
    expect(timeInputValue(null)).toBe("");
    expect(timeInputValue(840)).toBe("14:00");
    expect(timeInputValue(0)).toBe("00:00");
    expect(timeInputValue(1440)).toBe("00:00");
  });
});
