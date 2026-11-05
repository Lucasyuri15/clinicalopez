import type postgres from "postgres";
import { z } from "zod";

import { userRole, type UserRole } from "./schema";

/**
 * Operações do DONO do banco (comandos locais `pnpm users:link` e `pnpm users:reset-mfa`).
 * Usam a conexão do `postgres` (DIRECT_URL) e por isso NÃO fazem parte do app em
 * execução. Ficam em src/server/db/ (único lugar com acesso direto ao Postgres).
 * Sem `server-only` de propósito: rodam via `tsx` fora do Next. Nada aqui imprime
 * senhas ou tokens.
 */

const emailSchema = z.email();

const USAGE_LINK =
  'Uso: pnpm users:link <e-mail> <admin|reception|professional> "<Nome completo>"';
const USAGE_RESET = "Uso: pnpm users:reset-mfa <e-mail> [--yes]";

export function parseLinkArgs(argv: readonly string[]): {
  email: string;
  role: UserRole;
  fullName: string;
  /** `--yes`: necessário para alterar um perfil que JÁ existe. */
  confirmed: boolean;
} {
  if (argv.length === 0) throw new Error(USAGE_LINK);
  const confirmed = argv.includes("--yes");
  const [rawEmail = "", rawRole = "", ...nameParts] = argv.filter(
    (arg) => arg !== "--yes",
  );

  const email = emailSchema.safeParse(rawEmail.trim().toLowerCase());
  if (!email.success) throw new Error(`E-mail inválido. ${USAGE_LINK}`);

  const role = userRole.enumValues.find((value) => value === rawRole);
  if (!role) {
    throw new Error(
      `Papel inválido. Use: ${userRole.enumValues.join(", ")}. ${USAGE_LINK}`,
    );
  }

  const fullName = nameParts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  if (!fullName || fullName.length > 120) {
    throw new Error(`Informe o nome completo (até 120 caracteres). ${USAGE_LINK}`);
  }
  return { email: email.data, role, fullName, confirmed };
}

export function parseResetMfaArgs(argv: readonly string[]): {
  email: string;
  confirmed: boolean;
} {
  const confirmed = argv.includes("--yes");
  const positional = argv.filter((arg) => arg !== "--yes");
  if (positional.length !== 1) throw new Error(USAGE_RESET);
  const email = emailSchema.safeParse((positional[0] ?? "").trim().toLowerCase());
  if (!email.success) throw new Error(`E-mail inválido. ${USAGE_RESET}`);
  return { email: email.data, confirmed };
}

async function findAuthUserId(
  tx: postgres.TransactionSql,
  email: string,
): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    select id from auth.users
    where lower(email) = ${email.toLowerCase()} and deleted_at is null`;
  if (rows.length === 0) {
    throw new Error(
      "Usuário não encontrado no Auth. Crie-o primeiro no painel do Supabase (Authentication → Users → Add user) e rode o comando de novo.",
    );
  }
  if (rows.length > 1) {
    throw new Error("Mais de um usuário com esse e-mail no Auth; revise no painel.");
  }
  return rows[0]!.id;
}

export type PreviousProfile = {
  role: UserRole;
  fullName: string;
  active: boolean;
  deleted: boolean;
};

/**
 * Cria (ou atualiza e reativa) o perfil do usuário já existente no Auth. Devolve o estado
 * ANTERIOR (`previous`) para o comando mostrar o que vai mudar e pedir confirmação.
 */
export async function linkProfile(
  tx: postgres.TransactionSql,
  input: { email: string; role: UserRole; fullName: string },
): Promise<{ userId: string; created: boolean; previous: PreviousProfile | null }> {
  const userId = await findAuthUserId(tx, input.email);
  const existing = await tx<
    { role: UserRole; full_name: string; active: boolean; deleted_at: Date | null }[]
  >`select role, full_name, active, deleted_at from public.profiles where id = ${userId}`;
  const before = existing[0];
  await tx`
    insert into public.profiles (id, full_name, role)
    values (${userId}, ${input.fullName}, ${input.role})
    on conflict (id) do update set
      full_name = excluded.full_name,
      role = excluded.role,
      active = true,
      deleted_at = null,
      updated_at = now()`;
  return {
    userId,
    created: !before,
    previous: before
      ? {
          role: before.role,
          fullName: before.full_name,
          active: before.active,
          deleted: before.deleted_at !== null,
        }
      : null,
  };
}

/**
 * Recuperação de 2FA (celular perdido): remove os fatores do usuário e encerra as
 * sessões dele. No próximo login ele cadastra o 2FA de novo.
 */
export async function resetMfa(
  tx: postgres.TransactionSql,
  input: { email: string },
): Promise<{ userId: string; factorsRemoved: number; sessionsRemoved: number }> {
  const userId = await findAuthUserId(tx, input.email);
  const factors = await tx`delete from auth.mfa_factors where user_id = ${userId} returning id`;
  const sessions = await tx`delete from auth.sessions where user_id = ${userId} returning id`;
  return { userId, factorsRemoved: factors.length, sessionsRemoved: sessions.length };
}
