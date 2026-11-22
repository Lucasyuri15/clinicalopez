import { describe, expect, it } from "vitest";

import { availableActions } from "./actions-available";
import { APPOINTMENT_STATUSES, allowedTransitions, type ActorRole } from "./status";

const ROLES: ActorRole[] = ["admin", "reception", "professional"];
const now = new Date("2026-11-23T15:00:00Z");
const past = new Date("2026-11-23T12:00:00Z");
const future = new Date("2026-11-23T18:00:00Z");

describe("availableActions (o que a tela oferece a cada papel)", () => {
  it("equipe vê Confirmar e Cancelar numa agendada futura; Realizada e Falta só depois do início", () => {
    for (const role of ["admin", "reception"] as const) {
      const ahead = availableActions({ role, status: "scheduled", startsAt: future, now });
      expect(ahead.statuses).toEqual(["confirmed"]);
      expect(ahead.canReschedule).toBe(true);
      expect(ahead.canCancel).toBe(true);

      const started = availableActions({ role, status: "scheduled", startsAt: past, now });
      expect(started.statuses).toEqual(["confirmed", "done", "no_show"]);
    }
  });

  it("o profissional só vê Realizada e Falta, e só depois do início; nunca remarca nem cancela", () => {
    const ahead = availableActions({ role: "professional", status: "scheduled", startsAt: future, now });
    expect(ahead).toEqual({ statuses: [], canReschedule: false, canCancel: false });

    const started = availableActions({ role: "professional", status: "confirmed", startsAt: past, now });
    expect(started).toEqual({ statuses: ["done", "no_show"], canReschedule: false, canCancel: false });
  });

  it("só o admin corrige Realizada ↔ Falta", () => {
    expect(availableActions({ role: "admin", status: "done", startsAt: past, now }).statuses).toEqual(["no_show"]);
    expect(availableActions({ role: "admin", status: "no_show", startsAt: past, now }).statuses).toEqual(["done"]);
    for (const role of ["reception", "professional"] as const) {
      expect(availableActions({ role, status: "done", startsAt: past, now }).statuses).toEqual([]);
      expect(availableActions({ role, status: "no_show", startsAt: past, now }).statuses).toEqual([]);
    }
  });

  it("Realizada, Falta e Cancelada não podem ser remarcadas nem canceladas", () => {
    for (const role of ROLES) {
      for (const status of ["done", "no_show", "cancelled"] as const) {
        const result = availableActions({ role, status, startsAt: past, now });
        expect(result.canReschedule).toBe(false);
        expect(result.canCancel).toBe(false);
      }
    }
  });

  it("Cancelada é terminal: nenhuma ação para ninguém", () => {
    for (const role of ROLES) {
      expect(availableActions({ role, status: "cancelled", startsAt: future, now })).toEqual({
        statuses: [],
        canReschedule: false,
        canCancel: false,
      });
    }
  });

  it("uma agendada que já passou ainda pode ser remarcada pela equipe (o novo horário é que precisa ser futuro)", () => {
    expect(availableActions({ role: "reception", status: "scheduled", startsAt: past, now }).canReschedule).toBe(true);
    expect(availableActions({ role: "reception", status: "confirmed", startsAt: past, now }).canReschedule).toBe(true);
  });

  it("nunca oferece um status que o mapa do papel não permite (todos os papéis × status × antes/depois)", () => {
    for (const role of ROLES) {
      for (const status of APPOINTMENT_STATUSES) {
        for (const startsAt of [past, future]) {
          const { statuses } = availableActions({ role, status, startsAt, now });
          for (const target of statuses) {
            expect(allowedTransitions(role, status)).toContain(target);
            expect(["confirmed", "done", "no_show"]).toContain(target); // cancelar tem fluxo próprio
          }
        }
      }
    }
  });

  it("começa exatamente agora: Realizada já vale (início <= agora)", () => {
    const result = availableActions({ role: "reception", status: "scheduled", startsAt: now, now });
    expect(result.statuses).toContain("done");
  });
});
