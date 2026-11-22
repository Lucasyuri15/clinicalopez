import { describe, expect, it } from "vitest";

import { zonedToUtc } from "@/lib/datetime";

import {
  CANCEL_REASON_MAX,
  cancelAppointmentSchema,
  createAppointmentSchema,
  parseAgendaFilters,
  rescheduleAppointmentSchema,
  statusChangeSchema,
} from "./schemas";

/** 2026-11-23 09:00 em Brasília. */
const NOW = new Date("2026-11-23T12:00:00Z");
const PATIENT = "11111111-1111-4111-8111-111111111111";
const PROFESSIONAL = "22222222-2222-4222-8222-222222222222";
const SERVICE = "33333333-3333-4333-8333-333333333333";
const ID = "44444444-4444-4444-8444-444444444444";

const create = (over: Record<string, unknown> = {}) =>
  createAppointmentSchema(NOW).safeParse({
    patientId: PATIENT,
    professionalId: PROFESSIONAL,
    serviceId: SERVICE,
    date: "2026-11-24",
    startTime: "09:00",
    durationMinutes: "50",
    ...over,
  });

const messages = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  result.success ? [] : (result.error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`);

describe("createAppointmentSchema", () => {
  it("aceita um agendamento válido e devolve instantes UTC prontos", () => {
    const result = create();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      patientId: PATIENT,
      professionalId: PROFESSIONAL,
      serviceId: SERVICE,
      startsAt: zonedToUtc("2026-11-24", "09:00"),
      endsAt: new Date(zonedToUtc("2026-11-24", "09:00").getTime() + 50 * 60_000),
    });
  });

  it("normaliza os UUIDs para minúsculas", () => {
    const result = create({ patientId: PATIENT.toUpperCase(), serviceId: SERVICE.toUpperCase() });
    expect(result.success && result.data.patientId).toBe(PATIENT);
    expect(result.success && result.data.serviceId).toBe(SERVICE);
  });

  it.each([
    ["patientId", "abc", "Paciente inválido."],
    ["professionalId", "", "Profissional inválido."],
    ["serviceId", "x", "Serviço inválido."],
  ])("recusa %s inválido", (field, value, message) => {
    expect(messages(create({ [field]: value }))).toEqual([`${field}: ${message}`]);
  });

  it("recusa data vazia ou que não existe", () => {
    expect(messages(create({ date: "" }))).toEqual(["date: Informe a data."]);
    expect(messages(create({ date: "2026-02-30" }))).toEqual(["date: Data inválida."]);
  });

  it("recusa horário fora do formato HH:MM e minutos que não são de 5 em 5", () => {
    expect(messages(create({ startTime: "" }))).toEqual(["startTime: Informe o horário de início (HH:MM)."]);
    expect(messages(create({ startTime: "9:00" }))).toEqual(["startTime: Informe o horário de início (HH:MM)."]);
    expect(messages(create({ startTime: "24:00" }))).toEqual(["startTime: Informe o horário de início (HH:MM)."]);
    expect(messages(create({ startTime: "09:03" }))).toEqual(["startTime: O horário deve ser de 5 em 5 minutos."]);
  });

  it.each(["", "0", "4", "7", "485", "481", "abc", "-5", "50.5"])("recusa a duração %j", (duration) => {
    expect(messages(create({ durationMinutes: duration }))).toEqual([
      "durationMinutes: Informe a duração em minutos (de 5 a 480, de 5 em 5).",
    ]);
  });

  it("aceita os limites da duração (5 e 480)", () => {
    expect(create({ durationMinutes: "5" }).success).toBe(true);
    expect(create({ durationMinutes: "480" }).success).toBe(true);
  });

  it("recusa início no passado, mas aceita a partir do instante atual", () => {
    expect(messages(create({ date: "2026-11-23", startTime: "08:55" }))).toEqual(["startTime: Esse horário já passou."]);
    expect(create({ date: "2026-11-23", startTime: "09:00" }).success).toBe(true); // início == agora
    expect(create({ date: "2026-11-23", startTime: "09:05" }).success).toBe(true);
    expect(messages(create({ date: "2026-11-20" }))).toEqual(["startTime: Esse horário já passou."]);
  });

  it("não repete o que foi digitado nas mensagens", () => {
    const issues = messages(create({ patientId: "segredo-do-paciente", startTime: "abc" })).join(" ");
    expect(issues).not.toContain("segredo");
    expect(issues).not.toContain("abc");
  });
});

describe("rescheduleAppointmentSchema", () => {
  const reschedule = (over: Record<string, unknown> = {}) =>
    rescheduleAppointmentSchema(NOW).safeParse({ id: ID, date: "2026-11-25", startTime: "14:30", durationMinutes: "60", ...over });

  it("aceita e devolve o novo intervalo, sem trocar profissional nem serviço", () => {
    const result = reschedule();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      id: ID,
      startsAt: zonedToUtc("2026-11-25", "14:30"),
      endsAt: new Date(zonedToUtc("2026-11-25", "14:30").getTime() + 60 * 60_000),
    });
    expect(result.data).not.toHaveProperty("professionalId");
    expect(result.data).not.toHaveProperty("serviceId");
  });

  it("recusa id inválido, passado e duração fora do limite", () => {
    expect(messages(reschedule({ id: "x" }))).toEqual(["id: Atendimento inválido."]);
    expect(messages(reschedule({ date: "2026-11-01" }))).toEqual(["startTime: Esse horário já passou."]);
    expect(messages(reschedule({ durationMinutes: "3" }))).toEqual([
      "durationMinutes: Informe a duração em minutos (de 5 a 480, de 5 em 5).",
    ]);
  });
});

describe("cancelAppointmentSchema", () => {
  it("o motivo é obrigatório, limpo e sem repetir o espaço", () => {
    const ok = cancelAppointmentSchema.safeParse({ id: ID, reason: "  Paciente   avisou que   viajou \n" });
    expect(ok.success && ok.data).toEqual({ id: ID, reason: "Paciente avisou que viajou" });
    expect(messages(cancelAppointmentSchema.safeParse({ id: ID, reason: "   " }))).toEqual([
      "reason: Informe o motivo do cancelamento.",
    ]);
    expect(messages(cancelAppointmentSchema.safeParse({ id: "x", reason: "ok" }))).toEqual(["id: Atendimento inválido."]);
  });

  it("limita o motivo e recusa caractere de controle, sem repetir o texto", () => {
    expect(cancelAppointmentSchema.safeParse({ id: ID, reason: "a".repeat(CANCEL_REASON_MAX) }).success).toBe(true);
    expect(messages(cancelAppointmentSchema.safeParse({ id: ID, reason: "a".repeat(CANCEL_REASON_MAX + 1) }))).toEqual([
      `reason: O motivo pode ter até ${CANCEL_REASON_MAX} caracteres.`,
    ]);
    const control = messages(cancelAppointmentSchema.safeParse({ id: ID, reason: "dado\u0000sensivel" }));
    expect(control).toEqual(["reason: O motivo contém caracteres inválidos."]);
    expect(control.join(" ")).not.toContain("sensivel");
  });
});

describe("statusChangeSchema", () => {
  it.each(["confirmed", "done", "no_show"])("aceita %s", (status) => {
    expect(statusChangeSchema.safeParse({ id: ID, status }).success).toBe(true);
  });

  it.each(["cancelled", "scheduled", "", "feito", undefined])("recusa %j (cancelar tem ação própria, com motivo)", (status) => {
    expect(messages(statusChangeSchema.safeParse({ id: ID, status }))).toEqual(["status: Status inválido."]);
  });

  it("recusa id inválido", () => {
    expect(messages(statusChangeSchema.safeParse({ id: "x", status: "done" }))).toEqual(["id: Atendimento inválido."]);
  });
});

describe("parseAgendaFilters (a URL nunca quebra a tela)", () => {
  const TODAY = "2026-11-23";

  it("sem parâmetros: visão de dia, hoje, sem filtros", () => {
    expect(parseAgendaFilters({}, TODAY)).toEqual({ view: "day", date: TODAY, professional: null, specialty: null });
  });

  it("aceita visão, data, profissional e especialidade válidos", () => {
    expect(
      parseAgendaFilters({ view: "week", date: "2026-12-01", professional: PROFESSIONAL.toUpperCase(), specialty: "dentistry" }, TODAY),
    ).toEqual({ view: "week", date: "2026-12-01", professional: PROFESSIONAL, specialty: "dentistry" });
  });

  it("valores inválidos voltam ao padrão, sem erro", () => {
    expect(
      parseAgendaFilters({ view: "mes", date: "2026-02-30", professional: "x", specialty: "podologia" }, TODAY),
    ).toEqual({ view: "day", date: TODAY, professional: null, specialty: null });
    expect(parseAgendaFilters({ date: "amanhã" }, TODAY).date).toBe(TODAY);
  });

  it("parâmetro repetido (array): vale o primeiro", () => {
    expect(parseAgendaFilters({ view: ["week", "day"], date: ["2026-12-01", "2026-12-02"] }, TODAY)).toMatchObject({
      view: "week",
      date: "2026-12-01",
    });
  });

  it("ignora data fora do intervalo de anos suportado", () => {
    expect(parseAgendaFilters({ date: "0001-01-01" }, TODAY).date).toBe(TODAY);
    expect(parseAgendaFilters({ date: "2200-01-01" }, TODAY).date).toBe(TODAY);
  });
});
