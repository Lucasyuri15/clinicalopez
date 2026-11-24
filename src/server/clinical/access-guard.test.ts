// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guarda do prontuário (Fase 4A), na linha do `server-actions-guard.test.ts`. A abordagem escolhida
 * para o log de acesso é que o APP grave o registro na mesma transação da leitura ou da gravação (o
 * banco não impõe a leitura com log); por isso estas duas regras são testadas aqui e não podem ser
 * esquecidas:
 *  1. só `src/server/clinical/` (e `src/server/db/`, onde vivem o esquema e os testes de RLS) toca as
 *     tabelas clínicas: um caminho de leitura novo, fora daqui, ficaria sem log;
 *  2. toda função exportada das consultas e das gravações chama `recordAccess`.
 */
const TABLES = /\b(clinicalNotes|clinicalNoteAddenda|clinicalAccessLog|clinicalAttachments|clinical_notes|clinical_note_addenda|clinical_access_log|clinical_attachments)\b/;
const ALLOWED_DIRS = [join("src", "server", "clinical"), join("src", "server", "db")];

/** Funções exportadas (`export [async] function nome`) e o texto do corpo até a próxima exportação. */
function exportedFunctions(source: string): { name: string; body: string }[] {
  const starts = [...source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)];
  return starts.map((match, i) => ({
    name: match[1] ?? "",
    body: source.slice(match.index, starts[i + 1]?.index ?? source.length),
  }));
}

export function withoutAccessLog(source: string): string[] {
  return exportedFunctions(source)
    .filter(({ body }) => !/\brecordAccess\s*\(/.test(body))
    .map(({ name }) => name);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  });
}

describe("o prontuário nunca é lido nem gravado sem registrar o acesso", () => {
  it("o detector acusa a função que não chama `recordAccess` e aceita a que chama", () => {
    const sample = `
export async function reads() { return tx.select(); }
export async function writes() { await recordAccess(tx, { action: "finalize", patientId }); }
export type Tipo = string;`;
    expect(withoutAccessLog(sample)).toEqual(["reads"]);
  });

  it("o detector de tabelas pega também o nome SQL (leitura crua em outro módulo)", () => {
    expect(TABLES.test('tx.execute(sql`select body from clinical_notes`)')).toBe(true);
    expect(TABLES.test("tx.select().from(clinicalNoteAddenda)")).toBe(true);
    expect(TABLES.test("const notes = [];")).toBe(false);
  });

  it("só src/server/clinical e src/server/db mencionam as tabelas clínicas", () => {
    const files = sourceFiles(join(process.cwd(), "src"));
    expect(files.length).toBeGreaterThan(0); // não passa vazio se a varredura quebrar
    const offenders = files
      .filter((file) => TABLES.test(readFileSync(file, "utf8")))
      .map((file) => relative(process.cwd(), file))
      .filter((file) => !ALLOWED_DIRS.some((dir) => file === dir || file.startsWith(dir + sep)));
    expect(offenders).toEqual([]);
  });

  it.each(["queries.ts", "mutations.ts", "attachments.ts"])("toda função exportada de %s registra o acesso", (name) => {
    const source = readFileSync(join(process.cwd(), "src", "server", "clinical", name), "utf8");
    expect(exportedFunctions(source).length).toBeGreaterThan(0);
    expect(withoutAccessLog(source)).toEqual([]);
  });
});
