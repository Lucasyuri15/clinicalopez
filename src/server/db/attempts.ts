import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { AttemptCounts } from "@/lib/auth/rate-limit-policy";

import { getDb } from "./client";

/**
 * Tentativas de login/2FA (limite próprio). Único código que chama `app.rate_limit_*`.
 * NÃO passa por `withUser`: no login o usuário ainda não existe para a RLS. A tabela é
 * fechada (nem o `app_backend` a lê); só as funções SECURITY DEFINER a tocam (migração 0005).
 */

export type AttemptKind = "login" | "mfa";

const count = z.number().int().nonnegative();
const age = z.number().int().nullable();

/** Valida o que o banco devolve (nunca confiar cegamente no que vem de fora do TypeScript). */
const beginRow = z.object({
  attempt_id: z.union([z.string(), z.number()]).transform(String),
  ip_failures: count,
  ip_last_age_s: age,
  pair_failures: count,
  pair_last_age_s: age,
  subject_failures: count,
});

export type BegunAttempt = { attemptId: string; counts: AttemptCounts };

/**
 * Grava a tentativa e devolve as contagens de ANTES dela. Chame ANTES de falar com o
 * Supabase: o banco serializa por IP/par, então tentativas em paralelo não escapam do limite.
 * A linha fica como falha, a não ser que `releaseAttempt` a apague.
 */
export async function beginAttempt(input: {
  kind: AttemptKind;
  ip: string;
  subjectHash: string;
  windowS: number;
}): Promise<BegunAttempt> {
  const rows = await getDb().execute(
    sql`select * from app.rate_limit_begin(${input.kind}, ${input.ip}, ${input.subjectHash}, ${input.windowS})`,
  );
  const row = beginRow.parse(rows[0]);
  return {
    attemptId: row.attempt_id,
    counts: {
      ipFailures: row.ip_failures,
      ipLastAgeS: row.ip_last_age_s,
      pairFailures: row.pair_failures,
      pairLastAgeS: row.pair_last_age_s,
      subjectFailures: row.subject_failures,
    },
  };
}

/**
 * Encerra a tentativa. `forgive` (só após login que DEU CERTO) apaga também as falhas
 * anteriores do mesmo par (tipo + IP + e-mail/usuário).
 */
export async function releaseAttempt(
  attemptId: string,
  forgive: boolean,
): Promise<void> {
  await getDb().execute(
    sql`select app.rate_limit_release(${attemptId}::bigint, ${forgive})`,
  );
}
