// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

/**
 * A CSP com nonce só funciona se TODA rota for renderizada por requisição. Medido no spike da
 * 1A-3 (docs/specs/2026-11-07-fase-1a3-endurecimento.md): com `cacheComponents` +
 * `partialPrefetching` o shell estático sai do build sem nonce → 11 scripts bloqueados e o
 * React não hidrata; sem eles e com o layout raiz dinâmico, 21 de 21 scripts levam o nonce.
 * Estes testes impedem que alguém volte a ligar isso (ou tire o `connection()`) sem perceber.
 */
describe("renderização dinâmica (pré-requisito do nonce)", () => {
  it("cacheComponents e partialPrefetching continuam DESLIGADOS", () => {
    const config = nextConfig as Record<string, unknown>;
    expect(config.cacheComponents).not.toBe(true);
    expect(config.partialPrefetching).not.toBe(true);
  });

  it("o layout raiz espera a requisição (connection) antes de renderizar", () => {
    const source = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(source).toMatch(/import\s*\{[^}]*\bconnection\b[^}]*\}\s*from\s*"next\/server"/);
    expect(source).toMatch(/export default async function RootLayout/);
    expect(source).toMatch(/await connection\(\)/);
  });
});
