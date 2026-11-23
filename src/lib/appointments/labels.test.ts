import { describe, expect, it } from "vitest";

import { occurrenceReasonLabel, statusActionLabel, statusLabel } from "./labels";
import { APPOINTMENT_STATUSES } from "./status";

describe("rótulos de status", () => {
  it("statusLabel cobre todos os status", () => {
    for (const status of APPOINTMENT_STATUSES) expect(statusLabel(status).length).toBeGreaterThan(0);
  });

  it("statusActionLabel é o texto do botão que leva de um status a outro", () => {
    expect(statusActionLabel("scheduled", "confirmed")).toBe("Confirmar atendimento");
    expect(statusActionLabel("scheduled", "done")).toBe("Marcar como realizada");
    expect(statusActionLabel("confirmed", "no_show")).toBe("Registrar falta");
  });

  it("a correção do admin (Realizada ↔ Falta) tem texto de correção", () => {
    expect(statusActionLabel("done", "no_show")).toBe("Corrigir para falta");
    expect(statusActionLabel("no_show", "done")).toBe("Corrigir para realizada");
  });
});

describe("rótulos dos motivos de uma data da série", () => {
  const reasons = ["past", "invalid", "crosses-midnight", "outside-grid", "time-off", "conflict-professional", "conflict-patient"] as const;

  it("todo motivo tem um texto curto em português, sem dado de paciente", () => {
    for (const reason of reasons) {
      const text = occurrenceReasonLabel(reason);
      expect(text.length).toBeGreaterThan(3);
      expect(text).not.toMatch(/undefined|\[object/);
    }
  });

  it("textos que a recepção precisa entender na prévia", () => {
    expect(occurrenceReasonLabel("time-off")).toBe("Folga ou bloqueio do profissional");
    expect(occurrenceReasonLabel("outside-grid")).toBe("Fora do atendimento do profissional");
    expect(occurrenceReasonLabel("conflict-professional")).toBe("O profissional já tem atendimento");
    expect(occurrenceReasonLabel("conflict-patient")).toBe("O paciente já tem atendimento");
    expect(occurrenceReasonLabel("past")).toBe("Já passou");
  });
});
