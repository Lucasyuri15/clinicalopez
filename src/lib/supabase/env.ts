import { z } from "zod";

/**
 * Variáveis PÚBLICAS do Supabase (vão para o navegador, não são segredo): URL do
 * projeto e chave *publishable*. São as ÚNICAS com prefixo NEXT_PUBLIC_ no projeto.
 * Ficam separadas do env do banco (`getServerEnv`) para o código de banco não
 * depender delas. Sem `server-only` de propósito: o `proxy` também as usa.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1)
    .refine((value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }),
  // Formato novo (`sb_publishable_…`). Recusa de propósito `sb_secret_…` e qualquer
  // outro valor: uma chave secret colada aqui seria exposta ao navegador.
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .refine((value) => value.startsWith("sb_publishable_") && value.length > 20),
});

export type PublicSupabaseEnv = { url: string; publishableKey: string };

/** A mensagem de erro cita só o NOME das variáveis, nunca o valor. */
export function parsePublicEnv(
  source: Record<string, string | undefined>,
): PublicSupabaseEnv {
  const result = publicEnvSchema.safeParse(source);
  if (!result.success) {
    const names = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ];
    throw new Error(
      `Variáveis de ambiente ausentes ou inválidas: ${names.join(", ")}. ` +
        "Confira o .env.local (modelo em .env.example): a URL do projeto deve ser https e a chave deve ser a publishable (sb_publishable_…), nunca a secret.",
    );
  }
  return {
    url: result.data.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: result.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getPublicEnv(): PublicSupabaseEnv {
  // Acesso LITERAL: o Next só inlina NEXT_PUBLIC_* quando o nome aparece por extenso.
  // Sem cache: o parse é barato e assim uma variável ausente nunca passa despercebida.
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
