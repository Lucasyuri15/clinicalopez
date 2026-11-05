import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { canAccess } from "@/lib/auth/access";

/**
 * Trava de convenção: o proxy e o layout NÃO bastam. Toda página do grupo `(app)` precisa
 * chamar `requirePageAccess("<rota>")` com a SUA rota, e a rota precisa estar registrada
 * na matriz de acesso (rota desconhecida é negada até para admin).
 */
const APP_DIR = path.join(process.cwd(), "src", "app", "(app)");

function pageFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

const pages = pageFiles(APP_DIR).map((file) => {
  const segments = path.relative(APP_DIR, path.dirname(file)).split(path.sep).filter(Boolean);
  return { file, route: `/${segments.join("/")}` };
});

describe("páginas do grupo (app)", () => {
  it("existem páginas para verificar (o teste não pode passar vazio)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(7);
  });

  for (const { file, route } of pages) {
    it(`${route} chama requirePageAccess("${route}")`, () => {
      const source = fs.readFileSync(file, "utf8");
      expect(source).toContain(`requirePageAccess("${route}")`);
    });

    it(`${route} está registrada na matriz de acesso (admin entra)`, () => {
      expect(canAccess("admin", route)).toBe(true);
    });
  }
});
