import "server-only";

import { and, asc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { patientPrivate, patientProfessionals, patients } from "@/server/db/schema";
import { withoutQueryDetails } from "@/server/db/pg-error";
import { withUser } from "@/server/db/with-user";

/**
 * Consultas de pacientes. Todas passam por `withUser` (RLS de verdade): o admin recebe todos; a
 * recepção, os não removidos; o PROFISSIONAL recebe só os pacientes vinculados a ele, e NUNCA os
 * dados administrativos nem os vínculos de colegas. O código não repete essa regra por papel:
 * `private` vem nulo para quem a RLS não deixa ler. `deleted_at is null` aqui é de exibição (o
 * admin enxerga removidos pela RLS, mas a tela nunca os mostra).
 *
 * DADO SENSÍVEL: nada daqui é logado; a busca por CPF só casa para quem lê `patient_private`.
 */
export type PatientUser = { userId: string };

/** O clínico-básico: é tudo o que a LISTA devolve (e tudo o que o profissional vê). */
export type PatientListItem = {
  id: string;
  fullName: string;
  /** "AAAA-MM-DD". */
  birthDate: string;
  /** Só dígitos (DDD + número). */
  phone: string | null;
  email: string | null;
  active: boolean;
};

/** Dados administrativos: só admin e recepção (para o profissional a RLS não devolve linha). */
export type PatientPrivateData = {
  /** 11 dígitos, ou nulo quando `noCpfReason` está preenchido. */
  cpf: string | null;
  noCpfReason: string | null;
  cep: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  insuranceId: string | null;
  insuranceCard: string | null;
  guardianName: string | null;
  guardianRelationship: string | null;
  guardianPhone: string | null;
  guardianCpf: string | null;
  adminNotes: string | null;
};

export type PatientDetail = PatientListItem & {
  /** Nulo para o profissional (e se o paciente ainda não tiver dados administrativos). */
  private: PatientPrivateData | null;
  /** Profissionais vinculados que o usuário pode ver (o profissional só vê o próprio vínculo). */
  professionalIds: string[];
};

export const DEFAULT_LIST_LIMIT = 50;

/** Falha inesperada do banco sem a consulta e os parâmetros (CPF, termo de busca) no erro/log. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
const uuid = z.guid();

const listColumns = {
  id: patients.id,
  fullName: patients.fullName,
  // `date` volta como texto "AAAA-MM-DD" (modo string): sem fuso, sem `Date`.
  birthDate: patients.birthDate,
  phone: patients.phone,
  email: patients.email,
  active: patients.active,
};

/** Minúsculas e sem acento, igual ao que o SQL faz em `fold` (ver abaixo). */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Escapa `\`, `%` e `_` para o termo valer como texto no LIKE. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Nome sem acento e em minúsculas, no banco. `translate` em vez da extensão `unaccent` (não
 * instalada): sem migração e sem índice, o que basta para o porte de uma clínica. A lista de
 * letras cobre o português e nomes estrangeiros comuns.
 */
const FROM = "áàâãäåéèêëíìîïóòôõöúùûüçñýÿÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑÝ";
const TO = "aaaaaaeeeeiiiiooooouuuucnyyAAAAAAEEEEIIIIOOOOOUUUUCNY";
const folded = (column: SQL | typeof patients.fullName) =>
  sql`lower(translate(${column}, ${FROM}, ${TO}))`;

/**
 * Lista com busca por nome (sem acento, sem diferenciar maiúsculas) ou por CPF (prefixo de 3 ou
 * mais dígitos, com ou sem pontuação). A busca por CPF consulta `patient_private` SOB a RLS: para
 * o profissional nunca casa, então a busca não serve de oráculo ("este CPF existe?").
 * Devolve até `limit` itens e avisa se havia mais (a tela pede para refinar a busca).
 */
export async function listPatients(
  user: PatientUser,
  options: { search?: string; limit?: number } = {},
): Promise<{ items: PatientListItem[]; truncated: boolean }> {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIST_LIMIT, 200));
  // Sem controles (o Postgres recusa o byte nulo) e com espaços juntados, como os nomes gravados.
  const term = (options.search ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  const digits = term.replace(/\D/g, "");
  // Só vale como CPF se o termo for número e pontuação de CPF (não "Maria 123").
  const looksLikeCpf = /^[\d.\-\s]+$/.test(term) && digits.length >= 3;

  const byName = term === "" ? undefined : ilike(folded(patients.fullName), `%${escapeLike(foldText(term))}%`);
  const byCpf = looksLikeCpf
    ? sql`exists (
        select 1 from ${patientPrivate}
        where ${patientPrivate.patientId} = ${patients.id} and ${patientPrivate.cpf} like ${`${digits}%`}
      )`
    : undefined;

  return guarded(() => withUser(user, async (tx) => {
    const rows = await tx
      .select(listColumns)
      .from(patients)
      .where(and(isNull(patients.deletedAt), term === "" ? undefined : or(byName, byCpf)))
      .orderBy(asc(sql`lower(${patients.fullName})`), asc(patients.id))
      .limit(limit + 1);
    return { items: rows.slice(0, limit), truncated: rows.length > limit };
  }));
}

/**
 * O paciente por id, ou `null` (não existe, removido, não é o do profissional, não é UUID).
 * `staff` (admin ou recepção, decidido pela tela a partir do papel da sessão): só então consulta os
 * dados administrativos e os vínculos. Para o profissional nem executa essas consultas: a RLS já
 * devolveria vazio, mas assim o dado administrativo nunca está em memória por um deslize futuro.
 */
export async function getPatient(
  user: PatientUser,
  id: string,
  options: { staff: boolean },
): Promise<PatientDetail | null> {
  if (!uuid.safeParse(id).success) return null;
  return guarded(() => withUser(user, async (tx) => {
    const [row] = await tx
      .select(listColumns)
      .from(patients)
      .where(and(eq(patients.id, id), isNull(patients.deletedAt)));
    if (!row) return null;
    if (!options.staff) return { ...row, private: null, professionalIds: [] };

    const [admin] = await tx
      .select({
        cpf: patientPrivate.cpf,
        noCpfReason: patientPrivate.noCpfReason,
        cep: patientPrivate.cep,
        street: patientPrivate.street,
        number: patientPrivate.number,
        complement: patientPrivate.complement,
        district: patientPrivate.district,
        city: patientPrivate.city,
        state: patientPrivate.state,
        insuranceId: patientPrivate.insuranceId,
        insuranceCard: patientPrivate.insuranceCard,
        guardianName: patientPrivate.guardianName,
        guardianRelationship: patientPrivate.guardianRelationship,
        guardianPhone: patientPrivate.guardianPhone,
        guardianCpf: patientPrivate.guardianCpf,
        adminNotes: patientPrivate.adminNotes,
      })
      .from(patientPrivate)
      .where(eq(patientPrivate.patientId, id));
    const links = await tx
      .select({ professionalId: patientProfessionals.professionalId })
      .from(patientProfessionals)
      .where(eq(patientProfessionals.patientId, id));
    return { ...row, private: admin ?? null, professionalIds: links.map((l) => l.professionalId) };
  }));
}
