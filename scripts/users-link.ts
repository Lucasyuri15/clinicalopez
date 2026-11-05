/**
 * Vincula um usuário JÁ criado no painel do Supabase (Authentication → Users → Add user)
 * a um papel do sistema. Uso:
 *   pnpm users:link <e-mail> <admin|reception|professional> "<Nome completo>" [--yes]
 * Criar um perfil novo não pede confirmação; ALTERAR um perfil existente (papel, nome,
 * reativar) mostra o estado anterior e só executa com `--yes`.
 */
import { linkProfile, parseLinkArgs } from "../src/server/db/admin-users";
import { fail, maskEmail, Rollback, targetProject, withOwnerTransaction } from "./lib/owner-db";

async function main() {
  const input = parseLinkArgs(process.argv.slice(2));
  console.log(`Projeto alvo: ${targetProject()}`);

  let result: Awaited<ReturnType<typeof linkProfile>> | undefined;
  try {
    await withOwnerTransaction(async (tx) => {
      result = await linkProfile(tx, input);
      // Perfil existente sem --yes: simulação (desfaz tudo).
      if (result.previous && !input.confirmed) throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  if (!result) throw new Error("Nada foi processado.");

  const who = `${maskEmail(input.email)} → ${input.role} (${input.fullName})`;
  if (result.previous && !input.confirmed) {
    const p = result.previous;
    const state = p.deleted ? "removido" : p.active ? "ativo" : "inativo";
    console.log(
      `SIMULAÇÃO (nada foi alterado): o perfil JÁ existe — hoje: ${p.role} (${p.fullName}), ${state}. ` +
        `Passaria a: ${who}, ativo. Rode de novo com --yes para confirmar.`,
    );
    return;
  }
  console.log(`${result.created ? "Perfil criado" : "Perfil atualizado"}: ${who}.`);
}

main().catch(fail);
