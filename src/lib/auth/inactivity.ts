/**
 * Timeout de inatividade (regras puras, sem I/O; quem lê e grava o cookie é o `proxy`).
 *
 * O cookie guarda o instante (ms) da última atividade. Não é assinado: protege o
 * computador esquecido aberto, não um cookie roubado (quem roubou a sessão também
 * controla este cookie). Mitigação: `HttpOnly` + `Secure` e JWT curto (ver a spec da 1A-3).
 */

/** Passou disso sem atividade → sessão encerrada. */
export const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;

export const ACTIVITY_COOKIE = "ls_activity";

/** Folga para relógios levemente diferentes entre instâncias do servidor. */
const CLOCK_SKEW_MS = 60 * 1000;

export type ActivityDecision =
  /** Sem sessão: apagar o cookie de atividade (não deixar resto de uma sessão antiga). */
  | "no-session"
  /** Inativo além do limite: encerrar a sessão. */
  | "expired"
  /** Sessão ativa: gravar a hora atual. */
  | "renew";

/** Lê o valor do cookie; qualquer coisa fora de ms inteiros plausíveis vira `null`. */
export function parseActivity(value: string | undefined, nowMs: number): number | null {
  if (!value || !/^\d{1,16}$/.test(value)) return null;
  const ms = Number(value);
  if (!Number.isSafeInteger(ms) || ms > nowMs + CLOCK_SKEW_MS) return null;
  return ms;
}

export function decideActivity({
  hasSession,
  lastActivityMs,
  nowMs,
}: {
  hasSession: boolean;
  lastActivityMs: number | null;
  nowMs: number;
}): ActivityDecision {
  if (!hasSession) return "no-session";
  // Sem registro (1ª requisição após o login ou cookie inválido): começa a contar agora.
  if (lastActivityMs === null) return "renew";
  if (nowMs - lastActivityMs > INACTIVITY_LIMIT_MS) return "expired";
  return "renew";
}
