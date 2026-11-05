import "server-only";

import { createHash } from "node:crypto";

import { headers } from "next/headers";

import {
  clientIpFrom,
  DEFAULT_CLIENT_IP_HEADER,
  UNKNOWN_IP,
} from "@/lib/auth/client-ip";
import { decideRateLimit, RATE_LIMIT } from "@/lib/auth/rate-limit-policy";
import { beginAttempt, releaseAttempt, type AttemptKind } from "@/server/db/attempts";
import { getServerEnv } from "@/server/env";

/**
 * Limite de tentativas de login/2FA, na frente do Supabase. Os limites do Supabase Auth
 * contam pelo IP de quem chama (o servidor da Vercel) e viram um balde compartilhado: um
 * atacante daria 429 para todos. Aqui a conta é por IP REAL do cliente e por par (e-mail+IP).
 *
 * Uso nas Server Actions:
 *   const gate = await beginRateLimited("login", email);
 *   if (gate.status !== "allowed") …recusa…
 *   …chama o Supabase…            // falhou (inclusive 429 do Supabase): não faça nada, a
 *                                 // linha já conta como falha
 *   await gate.succeed();          // deu certo: perdoa as falhas do par
 *
 * O 429 do próprio Supabase CONTA como falha de propósito: se apagássemos essas linhas, quem
 * esgota o balde do Supabase sumiria do nosso contador e nunca seria barrado por nós.
 *
 * Regras de segurança:
 * - FALHA FECHADA: se o banco não responder, não há login ("unavailable"). Sem o limite,
 *   liberar seria deixar tentar senha sem freio.
 * - Nada de dado pessoal em log (e-mail, IP, ID de usuário): só tipo e contagens.
 */

export type AttemptGate =
  | {
      status: "allowed";
      /** Credencial certa: apaga esta tentativa e as falhas anteriores do par. */
      succeed(): Promise<void>;
    }
  | { status: "blocked"; retryAfterSeconds: number }
  | { status: "unavailable" };

/** SHA-256 em hex: o banco guarda só isto, nunca o e-mail ou o ID em claro (pseudonimização). */
function hashSubject(kind: AttemptKind, subject: string): string {
  const normalized = kind === "login" ? subject.trim().toLowerCase() : subject;
  return createHash("sha256").update(normalized).digest("hex");
}

/** SQLSTATE do erro do Postgres, procurando também em `cause` (o drizzle embrulha o erro). */
function sqlState(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return "n/d";
}

let warnedUnknownIp = false;

/** Apaga/perdoa sem nunca estourar: uma falha aqui não pode derrubar o login nem o bloqueio. */
async function safeRelease(attemptId: string, forgive: boolean): Promise<void> {
  try {
    await releaseAttempt(attemptId, forgive);
  } catch {
    console.error("[auth] não foi possível atualizar o contador de tentativas");
  }
}

export async function beginRateLimited(
  kind: AttemptKind,
  subject: string,
): Promise<AttemptGate> {
  const ip = clientIpFrom(
    await headers(),
    getServerEnv().CLIENT_IP_HEADER ?? DEFAULT_CLIENT_IP_HEADER,
  );
  const subjectHash = hashSubject(kind, subject);

  // Em produção, sem IP todos dividem UM balde e quem errar a senha trava o login de todos.
  // Na Vercel o `x-real-ip` sempre existe; faltar indica proxy/host com cabeçalho diferente.
  if (ip === UNKNOWN_IP && process.env.NODE_ENV === "production" && !warnedUnknownIp) {
    warnedUnknownIp = true;
    console.warn(
      "[auth] IP do cliente desconhecido: confira CLIENT_IP_HEADER (todos os acessos dividem um só contador)",
    );
  }

  let begun;
  try {
    begun = await beginAttempt({ kind, ip, subjectHash, windowS: RATE_LIMIT.windowS });
  } catch (error) {
    // Só o SQLSTATE (lock_timeout 55P03, statement_timeout 57014, conexão 08xxx…), nunca a mensagem.
    console.error(
      `[auth] limite de tentativas indisponível (${kind}, código ${sqlState(error)}): acesso recusado`,
    );
    return { status: "unavailable" };
  }

  const decision = decideRateLimit(begun.counts);
  if (!decision.allowed) {
    // A tentativa bloqueada não conta (senão quem insiste prolongaria o próprio bloqueio).
    await safeRelease(begun.attemptId, false);
    return { status: "blocked", retryAfterSeconds: decision.retryAfterSeconds };
  }

  if (decision.alert) {
    // Mesmo e-mail/usuário atacado a partir de muitos IPs: não bloqueia (travaria a vítima),
    // mas fica registrado. Só o prefixo do hash, nunca o e-mail nem o IP.
    console.warn(
      `[auth] muitas falhas para o mesmo alvo vindas de IPs diferentes (${kind}, ${subjectHash.slice(0, 8)})`,
    );
  }

  return {
    status: "allowed",
    succeed: () => safeRelease(begun.attemptId, true),
  };
}
