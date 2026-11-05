/**
 * Vincula um usuário JÁ criado no painel do Supabase (Authentication → Users → Add user)
 * a um papel do sistema. Uso:
 *   pnpm users:link <e-mail> <admin|reception|professional> "<Nome completo>"
 */
import { linkProfile, parseLinkArgs } from "../src/server/db/admin-users";
import { fail, maskEmail, withOwnerTransaction } from "./lib/owner-db";

async function main() {
  const input = parseLinkArgs(process.argv.slice(2));
  const result = await withOwnerTransaction((tx) => linkProfile(tx, input));
  console.log(
    `${result.created ? "Perfil criado" : "Perfil atualizado"}: ${maskEmail(input.email)} → ${input.role} (${input.fullName}).`,
  );
}

main().catch(fail);
