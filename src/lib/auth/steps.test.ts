import { describe, expect, it } from "vitest";

import { nextAuthStep } from "./steps";

describe("nextAuthStep", () => {
  it("sem sessão: login", () => {
    expect(nextAuthStep({ hasSession: false })).toBe("login");
  });

  it("aal2: segue para o app (mesmo se nextLevel vier defasado)", () => {
    expect(nextAuthStep({ hasSession: true, currentLevel: "aal2", nextLevel: "aal2" })).toBe("app");
    expect(nextAuthStep({ hasSession: true, currentLevel: "aal2", nextLevel: "aal1" })).toBe("app");
  });

  it("aal1 com fator verificado (nextLevel aal2): pedir o código", () => {
    expect(nextAuthStep({ hasSession: true, currentLevel: "aal1", nextLevel: "aal2" })).toBe("mfa-verify");
  });

  it("aal1 sem fator (nextLevel aal1): cadastrar o 2FA", () => {
    expect(nextAuthStep({ hasSession: true, currentLevel: "aal1", nextLevel: "aal1" })).toBe("mfa-enroll");
  });

  it("dados ausentes ou desconhecidos nunca liberam o app", () => {
    expect(nextAuthStep({ hasSession: true })).toBe("mfa-enroll");
    expect(nextAuthStep({ hasSession: true, currentLevel: "aal3" as never, nextLevel: "aal2" })).not.toBe("app");
  });
});
