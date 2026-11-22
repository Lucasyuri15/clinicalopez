import { describe, expect, it } from "vitest";

import { STATUS_LABELS, statusLabel } from "./labels";
import {
  APPOINTMENT_STATUSES,
  allowedTransitions,
  blocksSlot,
  checkStatusChange,
  type ActorRole,
  type AppointmentStatus,
} from "./status";

const ROLES: ActorRole[] = ["admin", "reception", "professional"];

/**
 * O mapa esperado, escrito à mão (não calculado pelo código testado). Regras:
 *  - admin e recepção: Agendada → Confirmada, Realizada, Falta ou Cancelada; Confirmada → Realizada,
 *    Falta ou Cancelada;
 *  - o profissional: só Agendada/Confirmada → Realizada ou Falta (confirmar e cancelar é da recepção);
 *  - SÓ o admin corrige Realizada ↔ Falta;
 *  - Cancelada é terminal para todos;
 *  - "mudar" para o mesmo status não é transição.
 */
const EXPECTED: Record<ActorRole, Record<AppointmentStatus, AppointmentStatus[]>> = {
  admin: {
    scheduled: ["confirmed", "done", "no_show", "cancelled"],
    confirmed: ["done", "no_show", "cancelled"],
    done: ["no_show"],
    no_show: ["done"],
    cancelled: [],
  },
  reception: {
    scheduled: ["confirmed", "done", "no_show", "cancelled"],
    confirmed: ["done", "no_show", "cancelled"],
    done: [],
    no_show: [],
    cancelled: [],
  },
  professional: {
    scheduled: ["done", "no_show"],
    confirmed: ["done", "no_show"],
    done: [],
    no_show: [],
    cancelled: [],
  },
};

const PAST = new Date("2026-11-20T12:00:00Z");
const NOW = new Date("2026-11-23T12:00:00Z");
const FUTURE = new Date("2026-11-30T12:00:00Z");

describe("mapa de transições de status (todos os papéis × todos os pares)", () => {
  for (const role of ROLES) {
    for (const from of APPOINTMENT_STATUSES) {
      for (const to of APPOINTMENT_STATUSES) {
        const allowed = EXPECTED[role][from].includes(to);
        it(`${role}: ${from} → ${to} ${allowed ? "vale" : "é recusado"}`, () => {
          const result = checkStatusChange({ role, from, to, startsAt: PAST, now: NOW });
          if (allowed) expect(result).toEqual({ ok: true });
          else expect(result).toEqual({ ok: false, reason: "not-allowed" });
        });
      }
    }
  }

  it("allowedTransitions devolve exatamente o mapa esperado", () => {
    for (const role of ROLES) {
      for (const from of APPOINTMENT_STATUSES) {
        expect([...allowedTransitions(role, from)].sort(), `${role}: ${from}`).toEqual([...EXPECTED[role][from]].sort());
      }
    }
  });
});

describe("Realizada e Falta só depois do início do atendimento", () => {
  it.each(["done", "no_show"] as const)("recusa %s antes do início (too-early) para todos os papéis", (to) => {
    for (const role of ROLES) {
      expect(checkStatusChange({ role, from: "scheduled", to, startsAt: FUTURE, now: NOW }), role).toEqual({
        ok: false,
        reason: "too-early",
      });
    }
  });

  it("vale a partir do instante de início (início == agora)", () => {
    expect(checkStatusChange({ role: "professional", from: "confirmed", to: "done", startsAt: NOW, now: NOW })).toEqual({ ok: true });
  });

  it("confirmar e cancelar um atendimento futuro não é afetado", () => {
    expect(checkStatusChange({ role: "reception", from: "scheduled", to: "confirmed", startsAt: FUTURE, now: NOW })).toEqual({ ok: true });
    expect(checkStatusChange({ role: "reception", from: "confirmed", to: "cancelled", startsAt: FUTURE, now: NOW })).toEqual({ ok: true });
  });

  it("a razão 'not-allowed' vem antes de 'too-early'", () => {
    expect(checkStatusChange({ role: "professional", from: "cancelled", to: "done", startsAt: FUTURE, now: NOW })).toEqual({
      ok: false,
      reason: "not-allowed",
    });
  });

  it("a correção do admin (Realizada ↔ Falta) também exige que o atendimento já tenha começado", () => {
    expect(checkStatusChange({ role: "admin", from: "done", to: "no_show", startsAt: FUTURE, now: NOW })).toEqual({
      ok: false,
      reason: "too-early",
    });
  });
});

describe("blocksSlot (quem ocupa o horário)", () => {
  it("só a Cancelada libera o horário; Realizada e Falta continuam ocupando", () => {
    expect(blocksSlot("scheduled")).toBe(true);
    expect(blocksSlot("confirmed")).toBe(true);
    expect(blocksSlot("done")).toBe(true);
    expect(blocksSlot("no_show")).toBe(true);
    expect(blocksSlot("cancelled")).toBe(false);
  });
});

describe("rótulos em pt-BR", () => {
  it("há um rótulo para cada status, sem repetir", () => {
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([...APPOINTMENT_STATUSES].sort());
    expect(new Set(Object.values(STATUS_LABELS)).size).toBe(APPOINTMENT_STATUSES.length);
    expect(STATUS_LABELS).toEqual({
      scheduled: "Agendada",
      confirmed: "Confirmada",
      done: "Realizada",
      no_show: "Falta",
      cancelled: "Cancelada",
    });
  });

  it("statusLabel devolve o rótulo", () => {
    expect(statusLabel("no_show")).toBe("Falta");
  });
});
