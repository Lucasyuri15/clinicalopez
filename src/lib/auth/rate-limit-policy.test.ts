import { describe, expect, it } from "vitest";

import {
  decideRateLimit,
  RATE_LIMIT,
  type AttemptCounts,
} from "./rate-limit-policy";

const none: AttemptCounts = {
  ipFailures: 0,
  ipLastAgeS: null,
  pairFailures: 0,
  pairLastAgeS: null,
  subjectFailures: 0,
};
const counts = (partial: Partial<AttemptCounts>): AttemptCounts => ({ ...none, ...partial });

describe("decideRateLimit: par (e-mail + IP)", () => {
  it("sem falhas, libera", () => {
    expect(decideRateLimit(none)).toEqual({ allowed: true, alert: false });
  });

  it("até 4 falhas ainda libera (a 5ª é que dispara o atraso)", () => {
    expect(decideRateLimit(counts({ pairFailures: 4, pairLastAgeS: 0 })).allowed).toBe(true);
  });

  it("5 falhas: espera 1 min desde a última", () => {
    expect(decideRateLimit(counts({ pairFailures: 5, pairLastAgeS: 10 }))).toEqual({
      allowed: false,
      retryAfterSeconds: 50,
    });
  });

  it("passado o atraso, libera de novo (sem apagar as falhas)", () => {
    expect(decideRateLimit(counts({ pairFailures: 5, pairLastAgeS: 60 })).allowed).toBe(true);
    expect(decideRateLimit(counts({ pairFailures: 5, pairLastAgeS: 59 }))).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it("o atraso cresce: 8 falhas = 5 min, 10 falhas = 15 min", () => {
    expect(decideRateLimit(counts({ pairFailures: 8, pairLastAgeS: 100 }))).toEqual({
      allowed: false,
      retryAfterSeconds: 200,
    });
    expect(decideRateLimit(counts({ pairFailures: 10, pairLastAgeS: 0 }))).toEqual({
      allowed: false,
      retryAfterSeconds: 900,
    });
  });

  it("o atraso tem teto de 15 min, por mais falhas que haja", () => {
    expect(decideRateLimit(counts({ pairFailures: 500, pairLastAgeS: 0 }))).toEqual({
      allowed: false,
      retryAfterSeconds: 900,
    });
  });
});

describe("decideRateLimit: IP (teto geral, bem mais alto)", () => {
  it("19 falhas no IP libera; 20 espera 1 min; 30 espera 5 min; 40 espera 15 min", () => {
    expect(decideRateLimit(counts({ ipFailures: 19, ipLastAgeS: 0 })).allowed).toBe(true);
    expect(decideRateLimit(counts({ ipFailures: 20, ipLastAgeS: 0 }))).toMatchObject({ retryAfterSeconds: 60 });
    expect(decideRateLimit(counts({ ipFailures: 30, ipLastAgeS: 0 }))).toMatchObject({ retryAfterSeconds: 300 });
    expect(decideRateLimit(counts({ ipFailures: 40, ipLastAgeS: 0 }))).toMatchObject({ retryAfterSeconds: 900 });
  });

  it("vale o MAIOR atraso entre par e IP", () => {
    const decision = decideRateLimit(
      counts({ pairFailures: 5, pairLastAgeS: 0, ipFailures: 30, ipLastAgeS: 0 }),
    );
    expect(decision).toEqual({ allowed: false, retryAfterSeconds: 300 });
  });
});

describe("decideRateLimit: robustez e alerta", () => {
  it("falhas sem idade (null) contam como falha de agora (conservador)", () => {
    expect(decideRateLimit(counts({ pairFailures: 5, pairLastAgeS: null }))).toMatchObject({
      allowed: false,
      retryAfterSeconds: 60,
    });
  });

  it("idade negativa (relógio) não gera espera maior que o atraso", () => {
    expect(decideRateLimit(counts({ pairFailures: 5, pairLastAgeS: -30 }))).toMatchObject({
      retryAfterSeconds: 60,
    });
  });

  it("muitas falhas no mesmo e-mail, vindas de IPs diferentes, geram alerta mas NÃO bloqueiam", () => {
    const decision = decideRateLimit(counts({ subjectFailures: RATE_LIMIT.subjectAlertAt }));
    expect(decision).toEqual({ allowed: true, alert: true });
    expect(decideRateLimit(counts({ subjectFailures: RATE_LIMIT.subjectAlertAt - 1 }))).toEqual({
      allowed: true,
      alert: false,
    });
  });

  it("o alerta dispara em múltiplos do limite, não em toda tentativa (evita inundar o log num ataque)", () => {
    const at = RATE_LIMIT.subjectAlertAt;
    const alertAt = (n: number) => (decideRateLimit(counts({ subjectFailures: n })) as { alert: boolean }).alert;
    expect([alertAt(at), alertAt(at + 1), alertAt(2 * at - 1), alertAt(2 * at), alertAt(3 * at)]).toEqual([
      true,
      false,
      false,
      true,
      true,
    ]);
  });

  it("bloqueado também informa o alerta quando cabível", () => {
    const decision = decideRateLimit(
      counts({ pairFailures: 5, pairLastAgeS: 0, subjectFailures: 99 }),
    );
    expect(decision).toEqual({ allowed: false, retryAfterSeconds: 60 });
  });

  it("a janela e a escala são as combinadas (15 min; 1, 5 e 15 min)", () => {
    expect(RATE_LIMIT.windowS).toBe(15 * 60);
    expect(RATE_LIMIT.pair.map((s) => [s.failures, s.waitS])).toEqual([
      [5, 60],
      [8, 300],
      [10, 900],
    ]);
    expect(RATE_LIMIT.ip.map((s) => [s.failures, s.waitS])).toEqual([
      [20, 60],
      [30, 300],
      [40, 900],
    ]);
  });
});
