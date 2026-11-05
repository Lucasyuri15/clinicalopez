/**
 * Política do limite de tentativas de login/2FA (pura: sem banco, testável). O banco só
 * conta; quem decide é este módulo. Regras (decididas com o usuário na 1A-3):
 * - Conta por IP (teto geral) e por par e-mail+IP (teto menor), em janela deslizante.
 * - Atraso crescente: passou do teto, espera desde a ÚLTIMA falha; não há bloqueio de conta
 *   (quem soubesse o e-mail poderia travar o login de qualquer pessoa, inclusive o admin).
 * - Falhas do MESMO e-mail vindas de IPs diferentes só geram alerta (não bloqueiam).
 */

export type Step = { failures: number; waitS: number };

export const RATE_LIMIT = {
  /** Janela deslizante: só contam falhas dos últimos 15 minutos. */
  windowS: 15 * 60,
  /** Par e-mail+IP (ou usuário+IP no 2FA): atraso de 1, 5 e 15 min. */
  pair: [
    { failures: 5, waitS: 60 },
    { failures: 8, waitS: 300 },
    { failures: 10, waitS: 900 },
  ],
  /**
   * IP: teto geral bem mais alto. A recepção e os profissionais saem pelo MESMO IP público
   * da clínica, e só as FALHAS contam (um login que dá certo apaga a própria tentativa).
   */
  ip: [
    { failures: 20, waitS: 60 },
    { failures: 30, waitS: 300 },
    { failures: 40, waitS: 900 },
  ],
  /** Falhas no mesmo e-mail (qualquer IP) a partir das quais registramos um alerta. */
  subjectAlertAt: 30,
} as const satisfies {
  windowS: number;
  pair: readonly Step[];
  ip: readonly Step[];
  subjectAlertAt: number;
};

/** O que o banco devolve ao iniciar uma tentativa (contagens ANTES dela, na janela). */
export type AttemptCounts = {
  ipFailures: number;
  /** Segundos desde a última falha do IP; `null` se não há falhas. */
  ipLastAgeS: number | null;
  pairFailures: number;
  pairLastAgeS: number | null;
  /** Falhas do mesmo e-mail/usuário em qualquer IP (só para alerta). */
  subjectFailures: number;
};

export type RateDecision =
  | { allowed: true; alert: boolean }
  | { allowed: false; retryAfterSeconds: number };

/** Atraso do degrau mais alto atingido (0 se nenhum). */
function delayFor(failures: number, steps: readonly Step[]): number {
  let wait = 0;
  for (const step of steps) {
    if (failures >= step.failures) wait = Math.max(wait, step.waitS);
  }
  return wait;
}

/** Segundos que ainda faltam: atraso menos o tempo desde a última falha. */
function remaining(
  failures: number,
  lastAgeS: number | null,
  steps: readonly Step[],
): number {
  const delay = delayFor(failures, steps);
  if (delay === 0) return 0;
  // Sem idade (não deveria ocorrer com falhas) ou relógio estranho: conta como "agora".
  const age = Math.max(0, lastAgeS ?? 0);
  return Math.max(0, delay - age);
}

export function decideRateLimit(counts: AttemptCounts): RateDecision {
  const wait = Math.max(
    remaining(counts.pairFailures, counts.pairLastAgeS, RATE_LIMIT.pair),
    remaining(counts.ipFailures, counts.ipLastAgeS, RATE_LIMIT.ip),
  );
  if (wait > 0) return { allowed: false, retryAfterSeconds: Math.ceil(wait) };
  // Em múltiplos do limite (30, 60, 90…), não em toda tentativa: num ataque distribuído o
  // log seria inundado.
  const at = RATE_LIMIT.subjectAlertAt;
  return {
    allowed: true,
    alert: counts.subjectFailures >= at && counts.subjectFailures % at === 0,
  };
}
