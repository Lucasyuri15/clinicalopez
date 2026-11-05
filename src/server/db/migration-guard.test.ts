import { describe, expect, it } from "vitest";

import { assertMigrationTarget, extractProjectRef } from "./migration-guard";

const SESSION_POOLER =
  "postgresql://postgres.devref123:senha-fake@aws-1-sa-east-1.pooler.supabase.com:5432/postgres";
const DIRECT = "postgresql://postgres:senha-fake@db.devref123.supabase.co:5432/postgres";

describe("extractProjectRef", () => {
  it("lê o ref do usuário do pooler (postgres.<ref>)", () => {
    expect(extractProjectRef(SESSION_POOLER)).toBe("devref123");
  });

  it("lê o ref do host da conexão direta (db.<ref>.supabase.co)", () => {
    expect(extractProjectRef(DIRECT)).toBe("devref123");
  });

  it("devolve null quando não dá para saber o projeto", () => {
    expect(extractProjectRef("postgresql://u:p@localhost:5432/db")).toBeNull();
    expect(extractProjectRef("isto-nao-e-url")).toBeNull();
  });
});

describe("assertMigrationTarget", () => {
  it("passa quando o projeto é o permitido", () => {
    expect(() => assertMigrationTarget(SESSION_POOLER, "devref123")).not.toThrow();
    expect(() => assertMigrationTarget(DIRECT, "devref123")).not.toThrow();
  });

  it("recusa quando MIGRATION_PROJECT_REF não foi definido (falha fechada)", () => {
    expect(() => assertMigrationTarget(SESSION_POOLER, undefined)).toThrow(
      /MIGRATION_PROJECT_REF/,
    );
    expect(() => assertMigrationTarget(SESSION_POOLER, "")).toThrow(
      /MIGRATION_PROJECT_REF/,
    );
  });

  it("recusa quando o banco alvo é de outro projeto", () => {
    expect(() => assertMigrationTarget(SESSION_POOLER, "prodref999")).toThrow(
      /outro projeto/i,
    );
  });

  it("recusa quando não consegue identificar o projeto da URL", () => {
    expect(() =>
      assertMigrationTarget("postgresql://u:p@localhost:5432/db", "devref123"),
    ).toThrow(/identificar/i);
  });

  it("nunca vaza a senha nas mensagens de erro", () => {
    const messages: string[] = [];
    for (const [url, ref] of [
      [SESSION_POOLER, "prodref999"],
      [SESSION_POOLER, undefined],
      ["postgresql://u:senha-fake@localhost/db", "devref123"],
    ] as const) {
      try {
        assertMigrationTarget(url, ref);
      } catch (error) {
        messages.push((error as Error).message);
      }
    }
    expect(messages).toHaveLength(3);
    for (const message of messages) expect(message).not.toContain("senha-fake");
  });
});
