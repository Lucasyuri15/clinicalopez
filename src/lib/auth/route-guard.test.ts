import { describe, expect, it } from "vitest";

import { decideRoute } from "./route-guard";

const allow = { action: "next" } as const;
const to = (path: string) => ({ action: "redirect", to: path }) as const;

describe("decideRoute (checagem otimista do proxy)", () => {
  describe("sem sessão", () => {
    it("permite só /login", () => {
      expect(decideRoute({ pathname: "/login", aal: null })).toEqual(allow);
    });
    it("manda telas do app e rotas desconhecidas para /login", () => {
      for (const p of ["/dashboard", "/pacientes/1", "/qualquer", "/"]) {
        expect(decideRoute({ pathname: p, aal: null }), p).toEqual(to("/login"));
      }
    });
    it("manda as telas de 2FA para /login", () => {
      for (const p of ["/mfa", "/mfa/enroll", "/mfa/verify"]) {
        expect(decideRoute({ pathname: p, aal: null }), p).toEqual(to("/login"));
      }
    });
  });

  describe("aal1 (senha ok, 2FA pendente)", () => {
    it("permite as telas de 2FA e o /login", () => {
      for (const p of ["/mfa", "/mfa/enroll", "/mfa/verify", "/login"]) {
        expect(decideRoute({ pathname: p, aal: "aal1" }), p).toEqual(allow);
      }
    });
    it("bloqueia o app e manda para /mfa", () => {
      for (const p of ["/dashboard", "/financeiro", "/qualquer", "/"]) {
        expect(decideRoute({ pathname: p, aal: "aal1" }), p).toEqual(to("/mfa"));
      }
    });
  });

  describe("aal2 (autenticado com 2FA)", () => {
    it("permite o app", () => {
      for (const p of ["/dashboard", "/agenda", "/pacientes/1"]) {
        expect(decideRoute({ pathname: p, aal: "aal2" }), p).toEqual(allow);
      }
    });
    it("tira de /login e do 2FA, levando ao dashboard", () => {
      for (const p of ["/login", "/mfa", "/mfa/enroll", "/mfa/verify"]) {
        expect(decideRoute({ pathname: p, aal: "aal2" }), p).toEqual(to("/dashboard"));
      }
    });
  });

  describe("robustez", () => {
    it("normaliza barra final e ignora query", () => {
      expect(decideRoute({ pathname: "/login/", aal: null })).toEqual(allow);
      expect(decideRoute({ pathname: "/mfa/", aal: "aal1" })).toEqual(allow);
    });
    it("não trata prefixos parecidos como públicos", () => {
      expect(decideRoute({ pathname: "/login-evil", aal: null })).toEqual(to("/login"));
      expect(decideRoute({ pathname: "/mfa-evil", aal: "aal1" })).toEqual(to("/mfa"));
      expect(decideRoute({ pathname: "/loginx/mfa", aal: null })).toEqual(to("/login"));
    });
    it("nível desconhecido é tratado como sem 2FA (aal1), nunca como autenticado", () => {
      expect(decideRoute({ pathname: "/dashboard", aal: "aal3" as never })).toEqual(to("/mfa"));
    });
  });
});
