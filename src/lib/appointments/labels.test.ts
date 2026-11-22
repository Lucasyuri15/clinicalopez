import { describe, expect, it } from "vitest";

import { statusActionLabel, statusLabel } from "./labels";
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
