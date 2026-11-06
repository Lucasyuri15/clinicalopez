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

/** `<ref>` de `https://<ref>.supabase.co`; `null` para domínio próprio, Supabase local ou lixo. */
function refFromSupabaseUrl(value: string | undefined): string | null {
  try {
    const host = new URL(value ?? "").hostname.toLowerCase();
    const match = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** `<ref>` do usuário `app_backend.<ref>` do pooler; `null` se for o papel puro. */
function refFromDatabaseUrl(value: string): string | null {
  const user = decodeURIComponent(new URL(value).username);
  const dot = user.indexOf(".");
  return dot === -1 ? null : user.slice(dot + 1).toLowerCase() || null;
}

/**
 * Auth (URL pública) e banco (`DATABASE_URL`) têm de ser do MESMO projeto Supabase. Sem isso,
 * um Preview poderia autenticar no projeto de produção e ler o banco de dev (ou o inverso):
 * o JWT de um projeto valendo contra a RLS de outro. Só compara quando os dois refs existem
 * (domínio próprio, Supabase local e papel puro ficam de fora). Cita só os NOMES das variáveis.
 */
function assertSameProject(source: Record<string, string | undefined>, databaseUrl: string) {
  const authRef = refFromSupabaseUrl(source.NEXT_PUBLIC_SUPABASE_URL);
  const dbRef = refFromDatabaseUrl(databaseUrl);
  if (authRef && dbRef && authRef !== dbRef) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL e DATABASE_URL apontam para projetos Supabase diferentes. " +
        "Os dois precisam ser do mesmo projeto (Preview → dev; Production → produção). " +
        "Confira as variáveis do ambiente na Vercel (ou o .env.local).",
    );
  }
}

/**
 * Valida as variáveis de ambiente do servidor.
 * A mensagem de erro cita apenas o NOME das variáveis, nunca o valor
 * (as URLs contêm senha).
 */
export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (result.success) {
    assertSameProject(source, result.data.DATABASE_URL);
    return result.data;
  }

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
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    CLIENT_IP_HEADER: process.env.CLIENT_IP_HEADER,
  });
  return cached;
}
