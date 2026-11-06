import { describe, expect, it } from "vitest";

import {
  ACTIVITY_COOKIE,
  INACTIVITY_LIMIT_MS,
  decideActivity,
  parseActivity,
} from "./inactivity";

const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;

describe("constantes", () => {
  it("o limite é de 30 minutos", () => {
    expect(INACTIVITY_LIMIT_MS).toBe(30 * MIN);
  });
  it("o cookie tem nome fixo", () => {
    expect(ACTIVITY_COOKIE).toBe("ls_activity");
  });
});

describe("parseActivity", () => {
  it("lê um instante válido (ms inteiros)", () => {
    expect(parseActivity(String(NOW - 5 * MIN), NOW)).toBe(NOW - 5 * MIN);
  });

  it("ausente, vazio, lixo e não inteiro viram null", () => {
    for (const value of [undefined, "", "abc", "12.5", "1e12", "-5", "0x10", " 123", "9".repeat(30)]) {
      expect(parseActivity(value, NOW), String(value)).toBeNull();
    }
  });

  it("instante no futuro (além de 1 minuto de tolerância) vira null", () => {
    expect(parseActivity(String(NOW + 30 * 1000), NOW)).toBe(NOW + 30 * 1000);
    expect(parseActivity(String(NOW + 61 * 1000), NOW)).toBeNull();
  });
});

describe("decideActivity", () => {
  const base = { hasSession: true, nowMs: NOW };

  it("sem sessão: limpar o cookie de atividade", () => {
    expect(decideActivity({ ...base, hasSession: false, lastActivityMs: NOW })).toBe("no-session");
    expect(decideActivity({ ...base, hasSession: false, lastActivityMs: null })).toBe("no-session");
  });

  it("exatamente no limite ainda vale; 1 ms depois expira", () => {
    expect(decideActivity({ ...base, lastActivityMs: NOW - INACTIVITY_LIMIT_MS })).toBe("renew");
    expect(decideActivity({ ...base, lastActivityMs: NOW - INACTIVITY_LIMIT_MS - 1 })).toBe("expired");
  });

  it("dentro do prazo: renova", () => {
    expect(decideActivity({ ...base, lastActivityMs: NOW - 10 * MIN })).toBe("renew");
  });

  it("sem registro (primeira requisição após o login): começa a contar", () => {
    expect(decideActivity({ ...base, lastActivityMs: null })).toBe("renew");
  });

  it("relógio levemente adiantado entre instâncias não expira nem quebra", () => {
    expect(decideActivity({ ...base, lastActivityMs: NOW + 20 * 1000 })).toBe("renew");
  });
});
