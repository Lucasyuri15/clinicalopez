import "server-only";

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { PatientInput } from "@/lib/patients/schemas";
import { pgConstraintName, pgErrorCode, withoutQueryDetails } from "@/server/db/pg-error";
import { insurances, patientPrivate, patientProfessionals, patients } from "@/server/db/schema";
import { withUser, type Tx } from "@/server/db/with-user";

import type { PatientUser } from "./queries";

/**
 * Gravações de pacientes, sempre por `withUser` (a RLS decide quem grava; a camada de ações ainda
 * exige o papel). O cadastro, os dados administrativos e os vínculos são gravados numa ÚNICA
 * transação: se qualquer passo falhar, nada fica pela metade. O resultado é um valor, não uma
 * exceção: o erro do banco nunca sobe para a tela (nem o texto dele, que poderia trazer um CPF).
 * - `duplicate-cpf`: já existe outro cadastro com esse CPF (inclusive removido).
 * - `not-found`: nenhuma linha afetada (não existe, já removido, ou a RLS o esconde).
 * - `denied`: o banco recusou (sem permissão, vínculo com profissional inválido, convênio
 *   inexistente ou removido, texto inválido...).
 */
export type PatientResult =
  | { ok: true; id: string }
  | { ok: false; reason: "duplicate-cpf" | "not-found" | "denied" };

type Failure = Extract<PatientResult, { ok: false }>;

/** Lançada dentro da transação para DESFAZÊ-LA e devolver um resultado já conhecido. */
class Abort extends Error {
  constructor(readonly failure: Failure) {
    super(failure.reason);
  }
}

function toFailure(error: unknown): Failure {
  if (error instanceof Abort) return error.failure;
  switch (pgErrorCode(error)) {
    case "23505":
      return pgConstraintName(error) === "patient_private_cpf_uq"
        ? { ok: false, reason: "duplicate-cpf" }
        : { ok: false, reason: "denied" };
    case "42501": // sem permissão (RLS)
    case "23503": // chave estrangeira
    case "23514": // check
    case "22021": // byte inválido no texto
    case "22P02": // texto inválido para o tipo
      return { ok: false, reason: "denied" };
    default:
      // Erro inesperado (conexão...): não engolir, mas SEM a consulta e os parâmetros (CPF, endereço
      // etc.) que o erro do Drizzle carrega e o log do servidor registraria.
      throw withoutQueryDetails(error);
  }
}

async function guarded(run: () => Promise<PatientResult>): Promise<PatientResult> {
  try {
    return await run();
  } catch (error) {
    return toFailure(error);
  }
}

type Fields = Omit<PatientInput, "id" | "professionalIds">;

const patientColumns = (fields: Fields) => ({
  fullName: fields.fullName,
  birthDate: fields.birthDate,
  phone: fields.phone,
  email: fields.email,
});

const privateColumns = (fields: Fields) => ({
  cpf: fields.cpf,
  noCpfReason: fields.noCpfReason,
  cep: fields.cep,
  street: fields.street,
  number: fields.number,
  complement: fields.complement,
  district: fields.district,
  city: fields.city,
  state: fields.state,
  insuranceId: fields.insuranceId,
  insuranceCard: fields.insuranceCard,
  guardianName: fields.guardianName,
  guardianRelationship: fields.guardianRelationship,
  guardianPhone: fields.guardianPhone,
  guardianCpf: fields.guardianCpf,
  adminNotes: fields.adminNotes,
});

/** O convênio precisa existir e não estar removido (a chave estrangeira só garante que existe). */
async function assertInsuranceUsable(tx: Tx, insuranceId: string | null) {
  if (insuranceId === null) return;
  const [row] = await tx
    .select({ id: insurances.id })
    .from(insurances)
    .where(and(eq(insurances.id, insuranceId), isNull(insurances.deletedAt)));
  if (!row) throw new Abort({ ok: false, reason: "denied" });
}

/**
 * Leva os vínculos ao conjunto desejado por DIFERENÇA (apaga os que saíram, cria os novos), não
 * apagando tudo para recriar: um vínculo com profissional que depois foi desativado continua
 * valendo ao reeditar o paciente (a política só deixa CRIAR vínculo com profissional ativo).
 */
async function syncLinks(tx: Tx, patientId: string, wanted: readonly string[]) {
  const current = (
    await tx
      .select({ professionalId: patientProfessionals.professionalId })
      .from(patientProfessionals)
      .where(eq(patientProfessionals.patientId, patientId))
  ).map((row) => row.professionalId);

  const toRemove = current.filter((id) => !wanted.includes(id));
  if (toRemove.length > 0) {
    const removed = await tx
      .delete(patientProfessionals)
      .where(
        and(eq(patientProfessionals.patientId, patientId), inArray(patientProfessionals.professionalId, toRemove)),
      )
      .returning({ id: patientProfessionals.professionalId });
    // Quem não pode apagar apaga 0 linhas SEM erro: conferir, senão "desvincular" seria um sucesso falso.
    if (removed.length !== toRemove.length) throw new Abort({ ok: false, reason: "denied" });
  }
  const toAdd = wanted.filter((id) => !current.includes(id));
  if (toAdd.length > 0) {
    await tx.insert(patientProfessionals).values(toAdd.map((professionalId) => ({ patientId, professionalId })));
  }
}

export function createPatient(user: PatientUser, input: Omit<PatientInput, "id">) {
  const { professionalIds, ...fields } = input;
  return guarded(() =>
    withUser(user, async (tx): Promise<PatientResult> => {
      await assertInsuranceUsable(tx, fields.insuranceId);
      const [row] = await tx.insert(patients).values(patientColumns(fields)).returning({ id: patients.id });
      if (!row) throw new Abort({ ok: false, reason: "denied" });
      await tx.insert(patientPrivate).values({ patientId: row.id, ...privateColumns(fields) });
      await syncLinks(tx, row.id, professionalIds);
      return { ok: true, id: row.id };
    }),
  );
}

/**
 * Edita o cadastro e os dados administrativos e leva os vínculos ao novo conjunto. Uma TRAVA por
 * paciente serializa duas edições simultâneas: a segunda espera a primeira e então grava por cima
 * (vale a última gravação), em vez de esbarrar nos vínculos ainda não confirmados da outra.
 */
export function updatePatient(user: PatientUser, input: PatientInput & { id: string }) {
  const { id, professionalIds, ...fields } = input;
  return guarded(() =>
    withUser(user, async (tx): Promise<PatientResult> => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`patient:${id}`}, 0))`);

      const [existing] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(and(eq(patients.id, id), isNull(patients.deletedAt)));
      if (!existing) throw new Abort({ ok: false, reason: "not-found" });

      await assertInsuranceUsable(tx, fields.insuranceId);
      const updated = await tx
        .update(patients)
        .set(patientColumns(fields))
        .where(and(eq(patients.id, id), isNull(patients.deletedAt)))
        .returning({ id: patients.id });
      // Nenhuma linha (a RLS não deixa este papel editar, ou foi removido agora): desfaz tudo.
      if (!updated[0]) throw new Abort({ ok: false, reason: "not-found" });

      const savedPrivate = await tx
        .update(patientPrivate)
        .set(privateColumns(fields))
        .where(eq(patientPrivate.patientId, id))
        .returning({ id: patientPrivate.patientId });
      if (!savedPrivate[0]) await tx.insert(patientPrivate).values({ patientId: id, ...privateColumns(fields) });

      await syncLinks(tx, id, professionalIds);
      return { ok: true, id };
    }),
  );
}

export function setPatientActive(user: PatientUser, patientId: string, active: boolean) {
  return guarded(async () => {
    const rows = await withUser(user, (tx) =>
      tx
        .update(patients)
        .set({ active })
        .where(and(eq(patients.id, patientId), isNull(patients.deletedAt)))
        .returning({ id: patients.id }),
    );
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, reason: "not-found" };
  });
}

/**
 * Reativa um paciente removido (`deleted_at` volta a nulo): só o admin consegue (a política de
 * UPDATE da recepção exige `deleted_at` nulo e ela nem enxerga removidos, então para ela nada é
 * afetado: `not-found`). O cadastro volta como estava: CPF, dados administrativos, vínculos e o
 * histórico de consentimentos nunca saíram do banco. `not-found` também para quem não está removido.
 */
export function restorePatient(user: PatientUser, patientId: string) {
  return guarded(async () => {
    if (!z.guid().safeParse(patientId).success) return { ok: false, reason: "not-found" };
    const rows = await withUser(user, (tx) =>
      tx
        .update(patients)
        .set({ deletedAt: null })
        .where(and(eq(patients.id, patientId), isNotNull(patients.deletedAt)))
        .returning({ id: patients.id }),
    );
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, reason: "not-found" };
  });
}

/**
 * Remoção LÓGICA (`deleted_at`): só o admin (a política da recepção exige `deleted_at` nulo, então
 * a recepção recebe `denied`). O CPF continua reservado: o dado fica retido pela LGPD.
 */
export function removePatient(user: PatientUser, patientId: string) {
  return guarded(async () => {
    const rows = await withUser(user, (tx) =>
      tx
        .update(patients)
        .set({ deletedAt: new Date() })
        .where(and(eq(patients.id, patientId), isNull(patients.deletedAt)))
        .returning({ id: patients.id }),
    );
    return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, reason: "not-found" };
  });
}
