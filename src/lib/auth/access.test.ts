import { describe, expect, it } from "vitest";

import { canAccess, roleLabel, visibleNavItems } from "./access";

describe("canAccess (matriz de acesso por tela)", () => {
  const SECTIONS = [
    "/dashboard",
    "/agenda",
    "/pacientes",
    "/profissionais",
    "/servicos",
    "/financeiro",
    "/configuracoes",
  ];

  it("admin acessa todas as telas", () => {
    for (const path of SECTIONS) expect(canAccess("admin", path), path).toBe(true);
  });

  it("recepção acessa Dashboard, Agenda, Pacientes e Financeiro", () => {
    for (const path of ["/dashboard", "/agenda", "/pacientes", "/financeiro"]) {
      expect(canAccess("reception", path), path).toBe(true);
    }
  });

  it("recepção não acessa Profissionais, Serviços nem Configurações", () => {
    for (const path of ["/profissionais", "/servicos", "/configuracoes"]) {
      expect(canAccess("reception", path), path).toBe(false);
    }
  });

  it("profissional acessa só Dashboard, Agenda e Pacientes", () => {
    for (const path of ["/dashboard", "/agenda", "/pacientes"]) {
      expect(canAccess("professional", path), path).toBe(true);
    }
    for (const path of ["/profissionais", "/servicos", "/financeiro", "/configuracoes"]) {
      expect(canAccess("professional", path), path).toBe(false);
    }
  });

  it("subrotas herdam a regra da seção", () => {
    expect(canAccess("reception", "/pacientes/123/editar")).toBe(true);
    expect(canAccess("reception", "/configuracoes/seguranca")).toBe(false);
    expect(canAccess("professional", "/financeiro/relatorio")).toBe(false);
  });

  it("tolera barra final e ignora query/hash", () => {
    expect(canAccess("reception", "/agenda/")).toBe(true);
    expect(canAccess("reception", "/configuracoes/")).toBe(false);
    expect(canAccess("reception", "/agenda?dia=2026-01-01")).toBe(true);
  });

  it("rota desconhecida é negada (falha fechada), até para admin", () => {
    expect(canAccess("admin", "/qualquer-coisa")).toBe(false);
    expect(canAccess("admin", "/")).toBe(false);
  });

  it("não confunde prefixos parecidos", () => {
    expect(canAccess("admin", "/dashboard-evil")).toBe(false);
    expect(canAccess("reception", "/pacientesx")).toBe(false);
  });

  it("papel desconhecido ou ausente é negado", () => {
    expect(canAccess(undefined, "/dashboard")).toBe(false);
    expect(canAccess("hacker" as never, "/dashboard")).toBe(false);
  });
});

describe("visibleNavItems", () => {
  const items = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/profissionais", label: "Profissionais" },
    { href: "/financeiro", label: "Financeiro" },
  ];

  it("mostra só os itens permitidos ao papel, mantendo a ordem", () => {
    expect(visibleNavItems("reception", items).map((i) => i.href)).toEqual([
      "/dashboard",
      "/financeiro",
    ]);
    expect(visibleNavItems("admin", items)).toHaveLength(3);
  });
});

describe("roleLabel", () => {
  it("traduz os papéis para pt-BR", () => {
    expect(roleLabel("admin")).toBe("Administrador");
    expect(roleLabel("reception")).toBe("Recepção");
    expect(roleLabel("professional")).toBe("Profissional de saúde");
  });
});
