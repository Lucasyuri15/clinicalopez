import { describe, expect, it } from "vitest";

import { MAX_PERIOD_DAYS, REASON_MAX, timeOffInputSchema, weekInputSchema } from "./schemas";

const ID = "6f1c1b5e-8a3f-4a0e-9d57-2f6c5f0b7a11";
const H = (hours: number, minutes = 0) => hours * 60 + minutes;

const week = (ranges: unknown, over: Record<string, unknown> = {}) => ({
  professionalId: ID,
  ranges: JSON.stringify(ranges),
  ...over,
});
const weekError = (input: unknown) => {
  const result = weekInputSchema.safeParse(input);
  return result.success ? null : result.error.issues[0]?.message;
};

describe("weekInputSchema", () => {
  it("converte o JSON do formulário (horários em texto) para minutos, validado e ordenado", () => {
    const parsed = weekInputSchema.parse(
      week([
        { weekday: 1, start: "14:00", end: "18:00" },
        { weekday: 1, start: "08:00", end: "12:00" },
        { weekday: 6, start: "08:00", end: "12:30" },
      ]),
    );
    expect(parsed).toEqual({
      professionalId: ID,
      ranges: [
        { weekday: 1, start: H(8), end: H(12) },
        { weekday: 1, start: H(14), end: H(18) },
        { weekday: 6, start: H(8), end: H(12, 30) },
      ],
    });
  });

  it("semana vazia é válida (remove toda a grade)", () => {
    expect(weekInputSchema.parse(week([])).ranges).toEqual([]);
  });

  it.each([
    ["sobreposição", week([{ weekday: 1, start: "08:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "13:00" }]), "Segunda-feira: as faixas 08:00–12:00 e 11:00–13:00 se sobrepõem."],
    ["fim antes do início", week([{ weekday: 2, start: "12:00", end: "08:00" }]), "Terça-feira: o fim deve ser depois do início."],
    ["horário em formato errado", week([{ weekday: 1, start: "8h", end: "12:00" }]), "Use horários no formato 08:00."],
    ["horário vazio", week([{ weekday: 1, start: "", end: "12:00" }]), "Use horários no formato 08:00."],
    ["fora do passo de 5", week([{ weekday: 1, start: "08:03", end: "12:00" }]), "Segunda-feira: os horários devem ser de 5 em 5 minutos."],
    ["dia inválido", week([{ weekday: 9, start: "08:00", end: "12:00" }]), "Dia da semana inválido."],
    ["dia em texto", week([{ weekday: "1", start: "08:00", end: "12:00" }]), "Dados da semana inválidos."],
    ["item que não é objeto", week([42]), "Dados da semana inválidos."],
    ["não é uma lista", week({ weekday: 1 }), "Dados da semana inválidos."],
    ["JSON quebrado", { professionalId: ID, ranges: "[{" }, "Dados da semana inválidos."],
    ["JSON enorme", { professionalId: ID, ranges: `[${" ".repeat(30_000)}]` }, "Dados da semana inválidos."],
    ["profissional inválido", week([], { professionalId: "x" }), "Registro inválido."],
  ])("recusa %s", (_label, input, message) => {
    expect(weekError(input)).toBe(message);
  });

  it("campos ausentes não estouram", () => {
    expect(weekInputSchema.safeParse({}).success).toBe(false);
  });
});

const off = (over: Record<string, unknown> = {}) => ({
  professionalId: ID,
  startDate: "2026-12-24",
  endDate: "2026-12-26",
  allDay: "on",
  startTime: "",
  endTime: "",
  reason: "",
  ...over,
});
const offError = (input: unknown) => {
  const result = timeOffInputSchema.safeParse(input);
  return result.success ? null : result.error.issues[0]?.message;
};

describe("timeOffInputSchema", () => {
  it("dia inteiro: da meia-noite do primeiro dia à meia-noite DEPOIS do último (horário de Brasília em UTC)", () => {
    const parsed = timeOffInputSchema.parse(off());
    expect(parsed.professionalId).toBe(ID);
    expect(parsed.startsAt.toISOString()).toBe("2026-12-24T03:00:00.000Z");
    expect(parsed.endsAt.toISOString()).toBe("2026-12-27T03:00:00.000Z");
    expect(parsed.reason).toBeNull();
  });

  it("um dia inteiro só (início = término)", () => {
    const parsed = timeOffInputSchema.parse(off({ endDate: "2026-12-24" }));
    expect(parsed.endsAt.getTime() - parsed.startsAt.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("bloqueio parcial: usa os horários de início e fim nas datas informadas", () => {
    const parsed = timeOffInputSchema.parse(
      off({ allDay: "", endDate: "2026-12-24", startTime: "14:00", endTime: "18:30", reason: "  Compromisso   pessoal " }),
    );
    expect(parsed.startsAt.toISOString()).toBe("2026-12-24T17:00:00.000Z");
    expect(parsed.endsAt.toISOString()).toBe("2026-12-24T21:30:00.000Z");
    expect(parsed.reason).toBe("Compromisso pessoal");
  });

  it("o bloqueio parcial pode atravessar dias", () => {
    const parsed = timeOffInputSchema.parse(off({ allDay: "", startTime: "18:00", endTime: "08:00" }));
    expect(parsed.endsAt.toISOString()).toBe("2026-12-26T11:00:00.000Z");
  });

  it("o período pode ter no máximo 366 dias (inclusive no limite)", () => {
    expect(timeOffInputSchema.safeParse(off({ startDate: "2026-01-01", endDate: "2026-12-31" })).success).toBe(true);
    expect(MAX_PERIOD_DAYS).toBe(366);
    expect(offError(off({ startDate: "2026-01-01", endDate: "2027-01-02" }))).toBe(
      "O período pode ter no máximo 366 dias.",
    );
  });

  it.each([
    ["início inexistente", off({ startDate: "2026-02-30" }), "Informe a data de início."],
    ["início vazio", off({ startDate: "" }), "Informe a data de início."],
    ["término inexistente", off({ endDate: "2026-13-01" }), "Informe a data de término."],
    ["ano de início fora de 2000 a 2100 (0026)", off({ startDate: "0026-12-24", endDate: "2026-12-26" }), "Informe uma data entre 2000 e 2100."],
    ["ano de término fora de 2000 a 2100 (9999)", off({ endDate: "9999-12-31" }), "Informe uma data entre 2000 e 2100."],
    ["antes de 2000", off({ startDate: "1999-12-31", endDate: "1999-12-31" }), "Informe uma data entre 2000 e 2100."],
    ["depois de 2100", off({ startDate: "2101-01-01", endDate: "2101-01-01" }), "Informe uma data entre 2000 e 2100."],
    ["motivo com byte nulo", off({ reason: "Fér\u0000ias" }), "O motivo contém caracteres inválidos."],
    ["motivo com caractere de controle", off({ reason: "Fér\u0007ias" }), "O motivo contém caracteres inválidos."],
    ["término antes do início", off({ startDate: "2026-12-26", endDate: "2026-12-24" }), "A data de término não pode ser antes da de início."],
    ["parcial sem horários", off({ allDay: "" }), "Informe os horários de início e de fim, de 5 em 5 minutos."],
    ["parcial com horário fora do passo", off({ allDay: "", startTime: "14:03", endTime: "18:00" }), "Informe os horários de início e de fim, de 5 em 5 minutos."],
    ["parcial com fim 24:00", off({ allDay: "", startTime: "14:00", endTime: "24:00" }), "Informe os horários de início e de fim, de 5 em 5 minutos."],
    ["parcial com fim antes do início no mesmo dia", off({ allDay: "", endDate: "2026-12-24", startTime: "18:00", endTime: "14:00" }), "O horário de fim deve ser depois do início."],
    ["parcial com fim igual ao início", off({ allDay: "", endDate: "2026-12-24", startTime: "14:00", endTime: "14:00" }), "O horário de fim deve ser depois do início."],
    ["motivo longo demais", off({ reason: "a".repeat(REASON_MAX + 1) }), `O motivo pode ter até ${REASON_MAX} caracteres.`],
    ["profissional inválido", off({ professionalId: "x" }), "Registro inválido."],
  ])("recusa %s", (_label, input, message) => {
    expect(offError(input)).toBe(message);
  });

  it("aceita os extremos 2000-01-01 e 2100-12-31", () => {
    expect(timeOffInputSchema.safeParse(off({ startDate: "2000-01-01", endDate: "2000-01-02" })).success).toBe(true);
    expect(timeOffInputSchema.safeParse(off({ startDate: "2100-12-30", endDate: "2100-12-31" })).success).toBe(true);
  });

  it("aceita o motivo no limite e normaliza espaços/NFC", () => {
    expect(timeOffInputSchema.parse(off({ reason: "a".repeat(REASON_MAX) })).reason).toHaveLength(REASON_MAX);
    expect(timeOffInputSchema.parse(off({ reason: "Férias" })).reason).toBe("Férias");
  });

  it("campos ausentes não estouram", () => {
    expect(timeOffInputSchema.safeParse({}).success).toBe(false);
  });
});
