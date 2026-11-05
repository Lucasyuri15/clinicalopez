import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254, { error: "Informe um e-mail válido." })
    .pipe(z.email({ error: "Informe um e-mail válido." })),
  // A senha não é alterada (espaços fazem parte dela); só limitamos o tamanho.
  password: z
    .string()
    .min(1, { error: "Informe a senha." })
    .max(256, { error: "Informe a senha." }),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Código TOTP: 6 dígitos; espaços (ex.: "123 456") são ignorados. */
export const totpCodeSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, { error: "Informe o código de 6 dígitos." }));
