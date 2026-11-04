import { describe, expect, test } from "vitest";
import { isActiveRoute, NAV_ITEMS } from "./navigation";

describe("NAV_ITEMS", () => {
  test("cada item tem rota absoluta única e um rótulo", () => {
    const hrefs = NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const item of NAV_ITEMS) {
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  test("começa pelo dashboard", () => {
    expect(NAV_ITEMS[0]?.href).toBe("/dashboard");
  });
});

describe("isActiveRoute", () => {
  test("é ativa na própria rota", () => {
    expect(isActiveRoute("/agenda", "/agenda")).toBe(true);
  });

  test("é ativa em sub-rotas", () => {
    expect(isActiveRoute("/pacientes/123/editar", "/pacientes")).toBe(true);
  });

  test("não confunde rotas com prefixo parecido", () => {
    expect(isActiveRoute("/agendamento", "/agenda")).toBe(false);
  });

  test("não é ativa em outras rotas", () => {
    expect(isActiveRoute("/financeiro", "/agenda")).toBe(false);
    expect(isActiveRoute("/", "/dashboard")).toBe(false);
  });
});
