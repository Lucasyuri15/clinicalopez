import * as OTPAuth from "otpauth";

function totp(secretBase32: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secretBase32.replace(/\s+/g, "")),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
}

export function currentCode(secret: string): string {
  return totp(secret).generate();
}

/** Espera o próximo período de 30 s para nunca reutilizar um código já usado. */
export async function codeDifferentFrom(
  secret: string,
  used: string,
  maxWaitMs = 35_000,
): Promise<string> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const code = currentCode(secret);
    if (code !== used) return code;
    if (Date.now() > deadline) throw new Error("Código TOTP não mudou a tempo.");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
