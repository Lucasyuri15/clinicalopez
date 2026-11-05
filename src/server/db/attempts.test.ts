import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { beginAttempt, releaseAttempt } from "./attempts";
import { assertMigrationTarget } from "./migration-guard";

/**
 * `beginAttempt`/`releaseAttempt` pelo caminho REAL do app (`getDb`, como `app_backend`),
 * contra o Supabase DEV. Dados fictícios (IP de documentação); o dono limpa depois.
 */
const hasDb = Boolean(process.env.DIRECT_URL && process.env.DATABASE_URL);
const IP = "198.51.100.240";
const SUBJECT = "a".repeat(64);
const OTHER = "b".repeat(64);
const WINDOW = 900;

describe.skipIf(!hasDb)("attempts (integração, Supabase dev)", () => {
  let owner: ReturnType<typeof postgres>;
  const cleanup = () => owner`delete from public.auth_attempts where ip = ${IP}`;

  beforeAll(async () => {
    assertMigrationTarget(process.env.DIRECT_URL ?? "", process.env.MIGRATION_PROJECT_REF);
    owner = postgres(process.env.DIRECT_URL ?? "", { prepare: false, max: 1, onnotice: () => {} });
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await owner?.end({ timeout: 2 });
  });

  it("devolve o ID e as contagens em camelCase, e cada chamada conta as anteriores", async () => {
    const first = await beginAttempt({ kind: "login", ip: IP, subjectHash: SUBJECT, windowS: WINDOW });
    expect(typeof first.attemptId).toBe("string");
    expect(first.counts).toEqual({
      ipFailures: 0,
      ipLastAgeS: null,
      pairFailures: 0,
      pairLastAgeS: null,
      subjectFailures: 0,
    });

    const second = await beginAttempt({ kind: "login", ip: IP, subjectHash: SUBJECT, windowS: WINDOW });
    expect(second.counts.pairFailures).toBe(1);
    expect(second.counts.ipFailures).toBe(1);
    expect(second.counts.pairLastAgeS).toBeGreaterThanOrEqual(0);
  });

  it("release sem perdão tira só a tentativa; com perdão limpa o par, e só ele", async () => {
    await cleanup();
    const a = await beginAttempt({ kind: "login", ip: IP, subjectHash: SUBJECT, windowS: WINDOW });
    const b = await beginAttempt({ kind: "login", ip: IP, subjectHash: SUBJECT, windowS: WINDOW });
    await beginAttempt({ kind: "login", ip: IP, subjectHash: OTHER, windowS: WINDOW });

    // `b` (bloqueada, por exemplo) sai sem perdão: sobra só `a` como falha anterior do par.
    await releaseAttempt(b.attemptId, false);
    const afterPlain = await beginAttempt({ kind: "login", ip: IP, subjectHash: SUBJECT, windowS: WINDOW });
    expect(afterPlain.counts.pairFailures).toBe(1);

    // Login que deu certo: apaga esta tentativa e as falhas do par (`a`).
    await releaseAttempt(afterPlain.attemptId, true);
    const afterForgive = await beginAttempt({ kind: "login", ip: IP, subjectHash: SUBJECT, windowS: WINDOW });
    expect(afterForgive.counts.pairFailures).toBe(0);
    const other = await beginAttempt({ kind: "login", ip: IP, subjectHash: OTHER, windowS: WINDOW });
    expect(other.counts.pairFailures).toBe(1);
    expect(a.attemptId).not.toBe(b.attemptId);
  });

  it("dado inválido vira erro (nunca grava linha torta)", async () => {
    await expect(
      beginAttempt({ kind: "login", ip: IP, subjectHash: "maria@exemplo.com", windowS: WINDOW }),
    ).rejects.toThrow();
    await expect(
      beginAttempt({ kind: "login", ip: "", subjectHash: SUBJECT, windowS: WINDOW }),
    ).rejects.toThrow();
  });
});
