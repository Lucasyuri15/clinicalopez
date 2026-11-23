import { describe, expect, it } from "vitest";

import { canAccess, roleLabel, visibleNavItems } from "./access";

describe("canAccess (matriz de acesso por tela)", () => {
  const SECTIONS = [
    "/dashboard",
    "/agenda",
    "/lista-espera",
    "/pacientes",
    "/profissionais",
    "/servicos",
    "/convenios",
    "/financeiro",
    "/configuracoes",
  ];

  it("admin acessa todas as telas", () => {
    for (const path of SECTIONS) expect(canAccess("admin", path), path).toBe(true);
  });

  it("recepção acessa Dashboard, Agenda, Lista de espera, Pacientes, Profissionais, Serviços, Convênios e Financeiro", () => {
    for (const path of ["/dashboard", "/agenda", "/lista-espera", "/pacientes", "/profissionais", "/servicos", "/convenios", "/financeiro"]) {
      expect(canAccess("reception", path), path).toBe(true);
    }
  });

  it("a lista de espera é gestão da equipe: o profissional não acessa a tela nem as sub-rotas", () => {
    for (const path of ["/lista-espera", "/lista-espera/", "/lista-espera?aba=encerradas", "/lista-espera/qualquer"]) {
      expect(canAccess("professional", path), path).toBe(false);
    }
    expect(canAccess(undefined, "/lista-espera")).toBe(false);
    expect(canAccess("reception", "/lista-esperax")).toBe(false);
  });

  it("recepção não acessa Configurações", () => {
    for (const path of ["/configuracoes"]) {
      expect(canAccess("reception", path), path).toBe(false);
    }
  });

  it("profissional acessa Dashboard, Agenda, Pacientes, Profissionais (só o próprio cadastro) e Serviços (sem valores)", () => {
    for (const path of ["/dashboard", "/agenda", "/pacientes", "/profissionais", "/servicos"]) {
      expect(canAccess("professional", path), path).toBe(true);
    }
    for (const path of ["/convenios", "/financeiro", "/configuracoes"]) {
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

  it("/pacientes/removidos é só do admin; o resto de Pacientes segue aberto aos três perfis", () => {
    for (const path of ["/pacientes/removidos", "/pacientes/removidos/", "/pacientes/removidos?x=1", "/pacientes/removidos/abc"]) {
      expect(canAccess("admin", path), path).toBe(true);
      expect(canAccess("reception", path), path).toBe(false);
      expect(canAccess("professional", path), path).toBe(false);
    }
    expect(canAccess(undefined, "/pacientes/removidos")).toBe(false);
    for (const role of ["admin", "reception", "professional"] as const) {
      expect(canAccess(role, "/pacientes"), role).toBe(true);
      expect(canAccess(role, "/pacientes/6f1c1b5e-8a3f-4a0e-9d57-2f6c5f0b7a11"), role).toBe(true);
    }
  });

  it("a exceção de sub-rota não confunde prefixos parecidos", () => {
    expect(canAccess("reception", "/pacientes/removidosx")).toBe(true);
    expect(canAccess("reception", "/pacientes/removidos-antigos")).toBe(true);
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
    { href: "/configuracoes", label: "Configurações" },
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
