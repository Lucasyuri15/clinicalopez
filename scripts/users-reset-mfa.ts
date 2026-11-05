/**
 * Recuperação de 2FA (celular perdido): remove os fatores do usuário e encerra as
 * sessões dele, para que cadastre o 2FA de novo no próximo login. Uso:
 *   pnpm users:reset-mfa <e-mail>          (simulação: mostra o que faria)
 *   pnpm users:reset-mfa <e-mail> --yes    (executa)
 */
import { parseResetMfaArgs, resetMfa } from "../src/server/db/admin-users";
import { fail, maskEmail, Rollback, targetProject, withOwnerTransaction } from "./lib/owner-db";

async function main() {
  const { email, confirmed } = parseResetMfaArgs(process.argv.slice(2));
  console.log(`Projeto alvo: ${targetProject()}`);

  let summary: Awaited<ReturnType<typeof resetMfa>> | undefined;
  try {
    await withOwnerTransaction(async (tx) => {
      summary = await resetMfa(tx, { email });
      if (!confirmed) throw new Rollback(); // simulação: desfaz tudo
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  if (!summary) throw new Error("Nada foi processado.");

  const detail = `${summary.factorsRemoved} fator(es) de 2FA e ${summary.sessionsRemoved} sessão(ões)`;
  if (confirmed) {
    console.log(`2FA reiniciado para ${maskEmail(email)}: removidos ${detail}.`);
    console.log(
      "ATENÇÃO: até a pessoa cadastrar um novo 2FA, quem souber a SENHA pode cadastrar o próprio " +
        "autenticador e assumir a conta. Troque a senha no painel (Authentication → Users) ANTES de " +
        "liberar o acesso e peça que ela cadastre o 2FA agora. O acesso por um token já emitido " +
        "pode durar até o fim da validade dele (padrão 1 h).",
    );
  } else {
    console.log(`SIMULAÇÃO (nada foi alterado): removeria ${detail} de ${maskEmail(email)}. Rode de novo com --yes para confirmar.`);
  }
}

main().catch(fail);
