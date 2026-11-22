import { describe, expect, it } from "vitest";

import {
  CONSENT_NOTE_MAX,
  consentStatus,
  createConsentInputSchema,
  currentConsents,
  lacksDataConsent,
  type ConsentEvent,
} from "./consents";

const TODAY = "2026-11-22";
const PATIENT = "11111111-1111-4111-8111-111111111111";

const valid = {
  patientId: PATIENT,
  kind: "data_processing",
  granted: "true",
  givenBy: "patient",
  method: "signed_paper",
  occurredOn: "2026-11-20",
  note: "",
};

const parse = (overrides: Record<string, unknown> = {}) =>
  createConsentInputSchema(TODAY).safeParse({ ...valid, ...overrides });

const messages = (overrides: Record<string, unknown>) => {
  const result = parse(overrides);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("createConsentInputSchema", () => {
  it("aceita um evento válido e devolve tipos prontos", () => {
    const result = parse();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      patientId: PATIENT,
      kind: "data_processing",
      granted: true,
      givenBy: "patient",
      method: "signed_paper",
      occurredOn: "2026-11-20",
      note: null,
    });
  });

  it("converte revogação e normaliza o UUID para minúsculas", () => {
    const result = parse({ granted: "false", patientId: PATIENT.toUpperCase() });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.granted).toBe(false);
    expect(result.data.patientId).toBe(PATIENT);
  });

  it("aceita a data de hoje e uma data bem antiga, mas não o futuro nem antes de 1900", () => {
    expect(parse({ occurredOn: TODAY }).success).toBe(true);
    expect(parse({ occurredOn: "1900-01-01" }).success).toBe(true);
    expect(messages({ occurredOn: "2026-11-23" })).toEqual([
      "occurredOn: A data do consentimento não pode ser no futuro.",
    ]);
    expect(messages({ occurredOn: "1899-12-31" })).toEqual([
      "occurredOn: A data do consentimento deve ser a partir de 1900.",
    ]);
  });

  it("recusa data vazia ou inexistente", () => {
    expect(messages({ occurredOn: "" })).toEqual(["occurredOn: Informe a data do consentimento."]);
    expect(messages({ occurredOn: "2026-02-30" })).toEqual(["occurredOn: Data do consentimento inválida."]);
  });

  it("recusa tipo, quem deu e forma fora da lista", () => {
    expect(messages({ kind: "email" })).toEqual(["kind: Escolha o tipo de consentimento."]);
    expect(messages({ givenBy: "mother" })).toEqual(["givenBy: Informe quem deu o consentimento."]);
    expect(messages({ method: "" })).toEqual(["method: Informe como o consentimento foi obtido."]);
  });

  it("exige escolher concedeu ou revogou", () => {
    expect(messages({ granted: "" })).toEqual(["granted: Informe se o consentimento foi concedido ou revogado."]);
    expect(messages({ granted: "maybe" })).toEqual([
      "granted: Informe se o consentimento foi concedido ou revogado.",
    ]);
  });

  it("recusa paciente inválido", () => {
    expect(messages({ patientId: "abc" })).toEqual(["patientId: Paciente inválido."]);
  });

  it("limpa a nota: espaços juntados, vazia vira null, limite de tamanho", () => {
    const trimmed = parse({ note: "  Assinou   na recepção \n " });
    expect(trimmed.success && trimmed.data.note).toBe("Assinou na recepção");
    const exact = parse({ note: "a".repeat(CONSENT_NOTE_MAX) });
    expect(exact.success).toBe(true);
    expect(messages({ note: "a".repeat(CONSENT_NOTE_MAX + 1) })).toEqual([
      `note: A nota pode ter até ${CONSENT_NOTE_MAX} caracteres.`,
    ]);
  });

  it("recusa caractere de controle na nota sem repetir o texto digitado", () => {
    const issues = messages({ note: "segredo\u0000" });
    expect(issues).toEqual(["note: A nota contém caracteres inválidos."]);
    expect(issues.join(" ")).not.toContain("segredo");
  });
});

const event = (overrides: Partial<ConsentEvent>): ConsentEvent => ({
  id: "e",
  kind: "data_processing",
  granted: true,
  givenBy: "patient",
  method: "signed_paper",
  occurredOn: "2026-11-01",
  note: null,
  registeredByName: null,
  createdAt: new Date("2026-11-01T12:00:00Z"),
  ...overrides,
});

describe("currentConsents", () => {
  it("sem eventos, nenhum tipo tem estado", () => {
    expect(currentConsents([])).toEqual({ data_processing: null, whatsapp: null });
  });

  it("o evento mais recente de cada tipo vale, e os tipos são independentes", () => {
    const events = [
      event({ id: "a", kind: "data_processing", granted: true, occurredOn: "2026-11-01" }),
      event({ id: "b", kind: "data_processing", granted: false, occurredOn: "2026-11-10" }),
      event({ id: "c", kind: "whatsapp", granted: true, occurredOn: "2026-11-05" }),
    ];
    const current = currentConsents(events);
    expect(current.data_processing?.id).toBe("b");
    expect(current.whatsapp?.id).toBe("c");
  });

  it("a data real do consentimento manda: revogação verbal de ontem, lançada hoje, vence concessão de anteontem", () => {
    const events = [
      event({ id: "grant", granted: true, occurredOn: "2026-11-20", createdAt: new Date("2026-11-20T10:00:00Z") }),
      event({ id: "revoke", granted: false, occurredOn: "2026-11-21", createdAt: new Date("2026-11-22T10:00:00Z") }),
    ];
    expect(currentConsents(events).data_processing?.id).toBe("revoke");
    expect(currentConsents([...events].reverse()).data_processing?.id).toBe("revoke");
  });

  it("registro tardio de um evento mais antigo não derruba o estado mais recente", () => {
    const events = [
      event({ id: "recent", granted: false, occurredOn: "2026-11-20", createdAt: new Date("2026-11-20T10:00:00Z") }),
      event({ id: "late", granted: true, occurredOn: "2026-11-01", createdAt: new Date("2026-11-22T10:00:00Z") }),
    ];
    expect(currentConsents(events).data_processing?.id).toBe("recent");
  });

  it("na mesma data real, vale o registrado por último", () => {
    const events = [
      event({ id: "first", granted: true, occurredOn: "2026-11-20", createdAt: new Date("2026-11-20T09:00:00Z") }),
      event({ id: "second", granted: false, occurredOn: "2026-11-20", createdAt: new Date("2026-11-20T09:05:00Z") }),
    ];
    expect(currentConsents(events).data_processing?.id).toBe("second");
    expect(currentConsents([...events].reverse()).data_processing?.id).toBe("second");
  });

  it("não altera a lista recebida", () => {
    const events = [event({ id: "a", occurredOn: "2026-11-10" }), event({ id: "b", occurredOn: "2026-11-01" })];
    currentConsents(events);
    expect(events.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("consentStatus e lacksDataConsent", () => {
  it("traduz o evento atual em estado", () => {
    expect(consentStatus(null)).toBe("none");
    expect(consentStatus(event({ granted: true }))).toBe("granted");
    expect(consentStatus(event({ granted: false }))).toBe("revoked");
  });

  it("avisa quando falta o consentimento de tratamento (nunca registrado ou revogado)", () => {
    expect(lacksDataConsent(currentConsents([]))).toBe(true);
    expect(lacksDataConsent(currentConsents([event({ granted: false })]))).toBe(true);
    expect(lacksDataConsent(currentConsents([event({ granted: true })]))).toBe(false);
  });

  it("o WhatsApp concedido não substitui o consentimento de tratamento", () => {
    const events = [event({ kind: "whatsapp", granted: true })];
    expect(lacksDataConsent(currentConsents(events))).toBe(true);
  });
});
