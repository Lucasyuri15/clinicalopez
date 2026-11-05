import "server-only";

import { z } from "zod";

/** Papel de login do app em execução (sem BYPASSRLS, sem privilégios próprios). */
const APP_ROLE = "app_backend";

const appDatabaseUrl = z
  .string()
  .min(1)
  .refine((value) => /^postgres(ql)?:\/\//i.test(value))
  .refine((value) => {
    try {
      // Pooler: o usuário é "<papel>.<ref>"; aceita também o papel puro.
      const user = decodeURIComponent(new URL(value).username);
      return user === APP_ROLE || user.startsWith(`${APP_ROLE}.`);
    } catch {
      return false;
    }
  });

/**
 * Variáveis do app em EXECUÇÃO (Vercel). Só `DATABASE_URL`, do papel `app_backend`.
 * `DIRECT_URL` (dono `postgres`) e `MIGRATION_PROJECT_REF` são usados apenas pelo
 * drizzle-kit e pelos testes de integração: NÃO devem existir nas variáveis do app
 * na Vercel, para que um vazamento de ambiente não entregue o dono do banco.
 */
const serverEnvSchema = z.object({
  /** Pooler (porta 6543), papel `app_backend.<ref>`. */
  DATABASE_URL: appDatabaseUrl,
  /**
   * Cabeçalho que a PLATAFORMA define com o IP do cliente (limite de tentativas de login).
   * Opcional: sem ele vale `x-real-ip` (Vercel). Em outro host, aponte para o cabeçalho que
   * o proxy dele sobrescreve (nunca um que o cliente consiga forjar). Linha em branco = ausente.
   */
  CLIENT_IP_HEADER: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,64}$/)
      .optional(),
  ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Valida as variáveis de ambiente do servidor.
 * A mensagem de erro cita apenas o NOME das variáveis, nunca o valor
 * (as URLs contêm senha).
 */
export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (result.success) return result.data;

  const names = [
    ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
  ];
  throw new Error(
    `Variáveis de ambiente ausentes ou inválidas: ${names.join(", ")}. ` +
      `Confira o .env.local (modelo em .env.example): DATABASE_URL deve começar com postgresql:// e usar o papel ${APP_ROLE} (usuário "${APP_ROLE}.<ref>" no pooler).`,
  );
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv({
    DATABASE_URL: process.env.DATABASE_URL,
    CLIENT_IP_HEADER: process.env.CLIENT_IP_HEADER,
  });
  return cached;
}
