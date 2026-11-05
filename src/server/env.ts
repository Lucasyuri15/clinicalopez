import "server-only";

import { z } from "zod";

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => /^postgres(ql)?:\/\//i.test(value));

const serverEnvSchema = z.object({
  /** Pooler (porta 6543), papel `app_backend`: usado pelo app em execução. */
  DATABASE_URL: postgresUrl,
  /** Conexão direta (porta 5432), papel `postgres`: só para migrações. */
  DIRECT_URL: postgresUrl,
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
      "Confira o .env.local (modelo em .env.example); as URLs devem começar com postgresql://.",
  );
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
