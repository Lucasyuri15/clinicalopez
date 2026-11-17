// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * O `proxy` deixa passar todo POST de Server Action (ver `src/proxy.ts`): a proteção de CADA
 * ação é dela. Este teste impede que uma ação nova esqueça a checagem: toda função exportada
 * de um arquivo `"use server"` precisa chamar `requireUser`/`requireRole`/`requirePageAccess`
 * (DAL) ou `requireStep` (passo do 2FA), ou estar na lista abaixo de ações públicas de
 * propósito. Acrescentar à lista exige justificar no PR.
 */
const PUBLIC_ACTIONS = new Set([
  "login", // ainda sem sessão (protegida pelo limite de tentativas)
  "logout", // só encerra a sessão local; sem sessão é inofensiva
]);
const GUARDS = /\b(requireUser|requireRole|requirePageAccess|requireStep)\s*\(/;

/** Funções exportadas (`export async function nome`) e o texto do corpo até a próxima exportação. */
export function exportedActions(source: string): { name: string; body: string }[] {
  const starts = [...source.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)];
  return starts.map((match, i) => ({
    name: match[1] ?? "",
    body: source.slice(match.index, starts[i + 1]?.index ?? source.length),
  }));
}

export function unguardedActions(source: string): string[] {
  return exportedActions(source)
    .filter(({ name, body }) => !PUBLIC_ACTIONS.has(name) && !GUARDS.test(body))
    .map(({ name }) => name);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  });
}

describe("Server Actions protegem a si mesmas", () => {
  it("o detector acusa uma ação sem checagem e aceita as com checagem ou públicas", () => {
    const sample = `"use server";
export async function aberta() { return 1; }
export async function protegida() { await requireRole("admin"); }
export async function passo() { await requireStep(x, "mfa-verify"); }
export async function login() { return 1; }`;
    expect(unguardedActions(sample)).toEqual(["aberta"]);
  });

  it("todo arquivo 'use server' do app só exporta ações protegidas (ou públicas de propósito)", () => {
    const files = sourceFiles(join(process.cwd(), "src")).filter((file) =>
      /^\s*["']use server["']/m.test(readFileSync(file, "utf8")),
    );
    expect(files.length).toBeGreaterThan(0); // não passa vazio se o glob quebrar
    for (const file of files) {
      expect({ file, unguarded: unguardedActions(readFileSync(file, "utf8")) }).toEqual({
        file,
        unguarded: [],
      });
    }
  });
});
