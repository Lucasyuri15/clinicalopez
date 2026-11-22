import "server-only";

import type { ConsentInput } from "@/lib/patients/consents";
import { pgErrorCode, withoutQueryDetails } from "@/server/db/pg-error";
import { patientConsents } from "@/server/db/schema";
import { withUser } from "@/server/db/with-user";

import type { PatientUser } from "./queries";

/**
 * Registro de consentimento (histórico SÓ DE INCLUSÃO: esta é a única gravação que existe; não há
 * edição nem remoção). Sempre por `withUser`: a RLS decide quem registra (admin e recepção, só para
 * paciente não removido, só em nome próprio) e a camada de ações ainda exige o papel. Quem registrou
 * e quando NÃO são parâmetros: o banco grava `auth.uid()` e `now()`.
 * O resultado é um valor, não uma exceção: o erro do banco nunca sobe para a tela (a nota é texto
 * livre e o erro do Drizzle carregaria os parâmetros).
 * - `denied`: o banco recusou (sem permissão, paciente removido ou inexistente, valor inválido).
 */
export type ConsentResult = { ok: true; id: string } | { ok: false; reason: "denied" };

function toFailure(error: unknown): ConsentResult {
  switch (pgErrorCode(error)) {
    case "42501": // sem permissão (RLS ou privilégio)
    case "23503": // chave estrangeira
    case "23514": // check
    case "22021": // byte inválido no texto
    case "22P02": // texto inválido para o tipo
    case "22008": // data fora do intervalo
      return { ok: false, reason: "denied" };
    default:
      // Erro inesperado (conexão...): não engolir, mas SEM a consulta e os parâmetros (a nota).
      throw withoutQueryDetails(error);
  }
}

export async function registerConsent(user: PatientUser, input: ConsentInput): Promise<ConsentResult> {
  try {
    return await withUser(user, async (tx) => {
      const [row] = await tx
        .insert(patientConsents)
        .values({
          patientId: input.patientId,
          kind: input.kind,
          granted: input.granted,
          givenBy: input.givenBy,
          method: input.method,
          occurredOn: input.occurredOn,
          note: input.note,
        })
        .returning({ id: patientConsents.id });
      return row ? ({ ok: true, id: row.id } as const) : ({ ok: false, reason: "denied" } as const);
    });
  } catch (error) {
    return toFailure(error);
  }
}
