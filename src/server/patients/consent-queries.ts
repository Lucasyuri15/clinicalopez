import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  currentConsents,
  lacksDataConsent,
  type ConsentEvent,
  type ConsentGivenBy,
  type ConsentKind,
  type ConsentMethod,
} from "@/lib/patients/consents";
import { withoutQueryDetails } from "@/server/db/pg-error";
import { patientConsents, profiles } from "@/server/db/schema";
import { withUser, type Tx } from "@/server/db/with-user";

import type { PatientUser } from "./queries";

/**
 * Consultas de consentimentos LGPD. Todas passam por `withUser` (RLS de verdade): admin e recepção
 * leem; o PROFISSIONAL nunca recebe linha (a RLS não tem política para ele). O código não repete a
 * regra por papel, exceto onde um resultado vazio seria enganoso (ver `patientsLackingDataConsent`).
 *
 * DADO SENSÍVEL: a nota é texto livre; nada daqui é logado e a falha do banco sobe sem a consulta.
 */
const uuid = z.guid();

/** Falha inesperada do banco sem a consulta e os parâmetros no erro/log. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}

const eventColumns = {
  id: patientConsents.id,
  kind: patientConsents.kind,
  granted: patientConsents.granted,
  givenBy: patientConsents.givenBy,
  method: patientConsents.method,
  occurredOn: patientConsents.occurredOn,
  note: patientConsents.note,
  createdAt: patientConsents.createdAt,
};

/** As colunas de texto têm `CHECK` no banco: os valores já são os do tipo. */
function toEvent(
  row: {
    id: string;
    kind: string;
    granted: boolean;
    givenBy: string;
    method: string;
    occurredOn: string;
    note: string | null;
    createdAt: Date;
  },
  registeredByName: string | null,
): ConsentEvent {
  return {
    id: row.id,
    kind: row.kind as ConsentKind,
    granted: row.granted,
    givenBy: row.givenBy as ConsentGivenBy,
    method: row.method as ConsentMethod,
    occurredOn: row.occurredOn,
    note: row.note,
    registeredByName,
    createdAt: row.createdAt,
  };
}

/**
 * Histórico de consentimentos do paciente, o mais recente primeiro (data real e, no empate, o
 * registrado por último). `registeredByName` só vem preenchido quando o perfil de quem registrou é
 * legível para o usuário (o admin lê todos; a recepção só o próprio): é da RLS de `profiles`.
 * UUID inválido devolve lista vazia sem consultar o banco.
 */
export async function listConsents(user: PatientUser, patientId: string): Promise<ConsentEvent[]> {
  if (!uuid.safeParse(patientId).success) return [];
  return guarded(() =>
    withUser(user, async (tx) => {
      const rows = await tx
        .select({ ...eventColumns, registeredByName: profiles.fullName })
        .from(patientConsents)
        .leftJoin(profiles, eq(profiles.id, patientConsents.registeredBy))
        .where(eq(patientConsents.patientId, patientId))
        .orderBy(desc(patientConsents.occurredOn), desc(patientConsents.createdAt), desc(patientConsents.id));
      return rows.map(({ registeredByName, ...row }) => toEvent(row, registeredByName));
    }),
  );
}

/**
 * Dos `patientIds` informados, os que NÃO têm consentimento de tratamento de dados vigente (nunca
 * registrado ou revogado): é o selo de aviso da lista. Só faz sentido para admin e recepção: para o
 * profissional a RLS devolve zero linhas e TODOS pareceriam sem consentimento, por isso `staff: false`
 * devolve vazio sem consultar (o profissional não vê o selo nem o consentimento).
 */
export async function patientsLackingDataConsent(
  user: PatientUser,
  patientIds: readonly string[],
  options: { staff: boolean },
): Promise<string[]> {
  if (!options.staff) return [];
  return guarded(() => withUser(user, (tx) => lackingDataConsentIn(tx, patientIds)));
}

/**
 * O mesmo cálculo dentro de uma transação já aberta (a lista de pacientes o usa na própria consulta,
 * sem outra ida ao banco). SÓ chamar para admin e recepção: para o profissional a RLS não devolve
 * linha e todos pareceriam sem consentimento.
 */
export async function lackingDataConsentIn(tx: Tx, patientIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(patientIds.filter((id) => uuid.safeParse(id).success).map((id) => id.toLowerCase()))];
  if (ids.length === 0) return [];
  const rows = await tx
    .select({ patientId: patientConsents.patientId, ...eventColumns })
    .from(patientConsents)
    .where(and(inArray(patientConsents.patientId, ids), eq(patientConsents.kind, "data_processing")))
    // A mesma ordem de `listConsents`: num empate, `currentConsents` fica com o primeiro (o mais recente).
    .orderBy(desc(patientConsents.occurredOn), desc(patientConsents.createdAt), desc(patientConsents.id));
  const byPatient = new Map<string, ConsentEvent[]>();
  for (const { patientId, ...row } of rows) {
    byPatient.set(patientId, [...(byPatient.get(patientId) ?? []), toEvent(row, null)]);
  }
  return ids.filter((id) => lacksDataConsent(currentConsents(byPatient.get(id) ?? [])));
}
