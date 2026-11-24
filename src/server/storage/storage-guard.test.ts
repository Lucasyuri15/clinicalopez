// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src");
const IMPORT = /from\s+["']@\/server\/storage(?:\/[^"']*)?["']|from\s+["']\.\.?\/(?:\.\.\/)*storage(?:\/[^"']*)?["']|import\(\s*["']@\/server\/storage/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/**
 * O Storage guarda dado clínico: só `src/server/clinical/` (que confere autor, papel e log antes de
 * cada leitura/escrita) e o próprio módulo de storage podem importá-lo (os testes também). Qualquer
 * outro arquivo que importe `@/server/storage` falha aqui.
 */
describe("guarda de importação do Storage", () => {
  const offenders = (list: string[]) => list.filter((file) => IMPORT.test(readFileSync(file, "utf8")));
  // Testes não vão para produção: podem usar o falso em memória.
  const allowed = (rel: string) =>
    rel.startsWith("server/clinical/") || rel.startsWith("server/storage/") || /\.test\.tsx?$/.test(rel);

  it("só src/server/clinical e src/server/storage importam o Storage", () => {
    const outside = files(ROOT)
      .map((file) => relative(ROOT, file))
      .filter((rel) => !allowed(rel));
    const bad = outside.filter((rel) => IMPORT.test(readFileSync(join(ROOT, rel), "utf8")));
    expect(bad).toEqual([]);
  });

  it("o detector pega as formas de importar (senão o teste acima não prova nada)", () => {
    const samples = [
      'import { x } from "@/server/storage";',
      "import { x } from '@/server/storage/memory-store';",
      'const m = await import("@/server/storage");',
      'import { x } from "../storage";',
    ];
    for (const sample of samples) expect(IMPORT.test(sample)).toBe(true);
    expect(IMPORT.test('import { x } from "@/server/clinical/queries";')).toBe(false);
    expect(offenders([])).toEqual([]);
  });
});
