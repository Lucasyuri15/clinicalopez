export type AuthStep = "login" | "mfa-enroll" | "mfa-verify" | "app";

/**
 * Próximo passo da autenticação, a partir de `mfa.getAuthenticatorAssuranceLevel()`.
 * Só `currentLevel === "aal2"` libera o app; o resto nunca libera.
 */
export function nextAuthStep(input: {
  hasSession: boolean;
  currentLevel?: string | null;
  nextLevel?: string | null;
}): AuthStep {
  if (!input.hasSession) return "login";
  if (input.currentLevel === "aal2") return "app";
  // Tem fator verificado (nextLevel aal2) => pedir o código; senão, cadastrar o 2FA.
  return input.nextLevel === "aal2" ? "mfa-verify" : "mfa-enroll";
}
