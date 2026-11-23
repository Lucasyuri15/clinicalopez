import { describe, expect, it } from "vitest";

import { addWaitlistSchema, bookFromWaitlistSchema, NOTE_MAX, removeWaitlistSchema, updateWaitlistSchema } from "./schemas";

const PATIENT = "11111111-1111-4111-8111-111111111111";
const SERVICE = "22222222-2222-4222-8222-222222222222";
const PROFESSIONAL = "33333333-3333-4333-8333-333333333333";
const ENTRY = "44444444-4444-4444-8444-444444444444";

const base = {
  patientId: PATIENT,
  serviceId: SERVICE,
  professionalId: "",
  weekdays: [] as string[],
  startTime: "",
  endTime: "",
  note: "",
};

const issues = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  result.error?.issues.map((issue) => String(issue.path[0])) ?? [];

describe("addWaitlistSchema", () => {
  it("só paciente e serviço: qualquer profissional, dia e horário", () => {
    const result = addWaitlistSchema().safeParse(base);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      patientId: PATIENT,
      serviceId: SERVICE,
      professionalId: null,
      weekdays: [],
      startMinute: null,
      endMinute: null,
      note: null,
    });
  });

  it("normaliza ids, dias (únicos e ordenados), faixa e nota", () => {
    const result = addWaitlistSchema().safeParse({
      ...base,
      patientId: ` ${PATIENT.toUpperCase()} `,
      professionalId: PROFESSIONAL,
      weekdays: ["4", "2", "2", " 1 "],
      startTime: "14:00",
      endTime: "18:30",
      note: "  prefere   à tarde  ",
    });
    expect(result.data).toEqual({
      patientId: PATIENT,
      serviceId: SERVICE,
      professionalId: PROFESSIONAL,
      weekdays: [1, 2, 4],
      startMinute: 840,
      endMinute: 1110,
      note: "prefere à tarde",
    });
  });

  it("aceita a faixa até 24:00", () => {
    const result = addWaitlistSchema().safeParse({ ...base, startTime: "18:00", endTime: "24:00" });
    expect(result.data).toMatchObject({ startMinute: 1080, endMinute: 1440 });
  });

  it("'00:00' como fim da faixa é a meia-noite (24:00), que o campo de hora não digita", () => {
    expect(addWaitlistSchema().safeParse({ ...base, startTime: "18:00", endTime: "00:00" }).data).toMatchObject({
      startMinute: 1080,
      endMinute: 1440,
    });
    // Início 00:00 e fim 00:00 continua sendo faixa vazia.
    expect(issues(addWaitlistSchema().safeParse({ ...base, startTime: "00:00", endTime: "00:00" }))).toEqual(["endTime"]);
  });

  it("recusa paciente, serviço e profissional que não são identificadores", () => {
    const result = addWaitlistSchema().safeParse({ ...base, patientId: "x", serviceId: "", professionalId: "abc" });
    expect(issues(result).sort()).toEqual(["patientId", "professionalId", "serviceId"]);
  });

  it("recusa dia da semana fora de 0 a 6", () => {
    expect(issues(addWaitlistSchema().safeParse({ ...base, weekdays: ["7"] }))).toEqual(["weekdays"]);
    expect(issues(addWaitlistSchema().safeParse({ ...base, weekdays: ["seg"] }))).toEqual(["weekdays"]);
    expect(addWaitlistSchema().safeParse({ ...base, weekdays: ["0", "6"] }).success).toBe(true);
  });

  it("a faixa exige início e fim juntos", () => {
    expect(issues(addWaitlistSchema().safeParse({ ...base, startTime: "14:00" }))).toEqual(["endTime"]);
    expect(issues(addWaitlistSchema().safeParse({ ...base, endTime: "18:00" }))).toEqual(["startTime"]);
  });

  it("a faixa é de 5 em 5 minutos, com início antes do fim", () => {
    expect(issues(addWaitlistSchema().safeParse({ ...base, startTime: "14:03", endTime: "18:00" }))).toEqual(["startTime"]);
    expect(issues(addWaitlistSchema().safeParse({ ...base, startTime: "14:00", endTime: "18:02" }))).toEqual(["endTime"]);
    expect(issues(addWaitlistSchema().safeParse({ ...base, startTime: "18:00", endTime: "18:00" }))).toEqual(["endTime"]);
    expect(issues(addWaitlistSchema().safeParse({ ...base, startTime: "18:00", endTime: "14:00" }))).toEqual(["endTime"]);
    expect(issues(addWaitlistSchema().safeParse({ ...base, startTime: "24:00", endTime: "24:00" }))).toEqual(["startTime"]);
    expect(issues(addWaitlistSchema().safeParse({ ...base, startTime: "9h", endTime: "18:00" }))).toEqual(["startTime"]);
  });

  it(`a nota tem até ${NOTE_MAX} caracteres e sem caractere de controle`, () => {
    expect(addWaitlistSchema().safeParse({ ...base, note: "a".repeat(NOTE_MAX) }).success).toBe(true);
    expect(issues(addWaitlistSchema().safeParse({ ...base, note: "a".repeat(NOTE_MAX + 1) }))).toEqual(["note"]);
    expect(issues(addWaitlistSchema().safeParse({ ...base, note: "oi\u0000" }))).toEqual(["note"]);
  });

  it("a nota não aceita caracteres invisíveis nem de direção do texto", () => {
    for (const invisible of ["\u200b", "\u2060", "\u202e", "\u2066", "\u200d"]) {
      expect(issues(addWaitlistSchema().safeParse({ ...base, note: `a${invisible}b` })), JSON.stringify(invisible)).toEqual(["note"]);
    }
    // Acentos e emojis simples continuam valendo.
    expect(addWaitlistSchema().safeParse({ ...base, note: "só à tarde, até às 18h 😀" }).success).toBe(true);
  });

  it("nenhuma mensagem de erro repete o que foi digitado", () => {
    const secret = "SEGREDO-DE-SAUDE";
    const result = addWaitlistSchema().safeParse({ ...base, note: secret.repeat(40), patientId: secret });
    expect(JSON.stringify(result.error?.issues)).not.toContain(secret);
  });
});

describe("updateWaitlistSchema", () => {
  const edit = { id: ENTRY, professionalId: "", weekdays: [] as string[], startTime: "", endTime: "", note: "" };

  it("edita só as preferências (paciente e serviço não entram)", () => {
    const result = updateWaitlistSchema().safeParse({ ...edit, professionalId: PROFESSIONAL, weekdays: ["3"] });
    expect(result.data).toEqual({
      id: ENTRY,
      professionalId: PROFESSIONAL,
      weekdays: [3],
      startMinute: null,
      endMinute: null,
      note: null,
    });
    expect(result.data).not.toHaveProperty("patientId");
    expect(result.data).not.toHaveProperty("serviceId");
  });

  it("recusa id inválido e as mesmas regras de faixa", () => {
    expect(issues(updateWaitlistSchema().safeParse({ ...edit, id: "nope" }))).toEqual(["id"]);
    expect(issues(updateWaitlistSchema().safeParse({ ...edit, startTime: "10:00" }))).toEqual(["endTime"]);
  });
});

describe("removeWaitlistSchema", () => {
  it("só o id", () => {
    expect(removeWaitlistSchema().safeParse({ id: ENTRY }).data).toEqual({ id: ENTRY });
    expect(removeWaitlistSchema().safeParse({ id: "x" }).success).toBe(false);
  });
});

describe("bookFromWaitlistSchema", () => {
  const raw = { entryId: ENTRY, professionalId: PROFESSIONAL, startsAt: "2031-06-02T12:00:00.000Z" };

  it("devolve a espera, o profissional e o início como Date (só isso: a duração é do servidor)", () => {
    const result = bookFromWaitlistSchema().safeParse(raw);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ entryId: ENTRY, professionalId: PROFESSIONAL, startsAt: new Date("2031-06-02T12:00:00.000Z") });
  });

  it("ignora campos a mais (duração, fim, paciente, serviço)", () => {
    const result = bookFromWaitlistSchema().safeParse({ ...raw, endsAt: "2031-06-02T13:00:00.000Z", durationMinutes: "600", patientId: PATIENT });
    expect(Object.keys(result.data ?? {}).sort()).toEqual(["entryId", "professionalId", "startsAt"]);
  });

  it("recusa id inválido e início que não é um instante UTC válido", () => {
    expect(issues(bookFromWaitlistSchema().safeParse({ ...raw, entryId: "x" }))).toEqual(["entryId"]);
    expect(issues(bookFromWaitlistSchema().safeParse({ ...raw, professionalId: "" }))).toEqual(["professionalId"]);
    for (const startsAt of ["", "amanhã", "2031-06-02", "2031-13-40T10:00:00Z", "2031-06-02T12:00:00"]) {
      expect(issues(bookFromWaitlistSchema().safeParse({ ...raw, startsAt })), startsAt).toEqual(["startsAt"]);
    }
  });
});
