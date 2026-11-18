"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ID_MESSAGE } from "@/lib/catalog/schemas";
import { todayBR } from "@/lib/datetime";
import { createPatientInputSchema } from "@/lib/patients/schemas";
import { requirePageAccess, requireRole } from "@/server/auth/session";
import type { CatalogFormState } from "@/server/catalog/actions";

import {
  createPatient,
  removePatient,
  setPatientActive,
  updatePatient,
  type PatientResult,
} from "./mutations";
import { listPatients, type PatientListItem } from "./queries";

/**
 * Server Actions de pacientes. Regras:
 * - TODAS começam com `requireRole(...)` (admin e recepção cadastram e inativam; SÓ o admin remove;
 *   o profissional nunca grava), antes de ler a entrada. O `proxy` deixa passar o POST de uma
 *   ação: a proteção é daqui (`server-actions-guard.test.ts` confere).
 * - O usuário vem da SESSÃO, nunca do formulário.
 * - Entrada validada com Zod (`src/lib/patients/schemas.ts`); mensagens fixas em pt-BR, nunca
 *   texto do banco (que poderia trazer um CPF).
 * - Em ERRO devolvem também os valores digitados: o React limpa o formulário depois de cada
 *   ação, e a tela os usa como valor inicial para ninguém redigitar tudo.
 * DADO SENSÍVEL: nada daqui é logado.
 */
export type PatientFormState = CatalogFormState;

const MESSAGES = {
  generic: "Não foi possível concluir. Tente novamente.",
  notFound: "Registro não encontrado. Atualize a página e tente de novo.",
  denied: "Não foi possível salvar. Confira o convênio e os profissionais escolhidos e tente de novo.",
  duplicateCpf: "Já existe um cadastro com este CPF (pode estar removido: procure o administrador).",
} as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Todos os valores de um campo repetido (caixas de seleção), só os que são texto. */
function texts(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === "string");
}

function failureMessage(result: Extract<PatientResult, { ok: false }>): string {
  switch (result.reason) {
    case "duplicate-cpf":
      return MESSAGES.duplicateCpf;
    case "not-found":
      return MESSAGES.notFound;
    case "denied":
      return MESSAGES.denied;
  }
}

const FIELDS = [
  "fullName",
  "birthDate",
  "phone",
  "email",
  "cpf",
  "noCpfReason",
  "cep",
  "street",
  "number",
  "complement",
  "district",
  "city",
  "state",
  "insuranceId",
  "insuranceCard",
  "guardianName",
  "guardianRelationship",
  "guardianPhone",
  "guardianCpf",
  "adminNotes",
] as const;

function revalidatePatients() {
  revalidatePath("/pacientes");
  revalidatePath("/pacientes/[id]", "page");
}

export async function savePatient(
  _prevState: PatientFormState,
  formData: FormData,
): Promise<PatientFormState> {
  const staff = await requireRole("admin", "reception");
  const professionalIds = texts(formData, "professionalIds");
  const noCpf = text(formData, "noCpf");
  const fields = Object.fromEntries(FIELDS.map((name) => [name, text(formData, name)])) as Record<
    (typeof FIELDS)[number],
    string
  >;
  const values = { ...fields, noCpf, professionalIds: professionalIds.join(",") };

  const parsed = createPatientInputSchema(todayBR()).safeParse({
    id: text(formData, "id") || undefined,
    ...fields,
    noCpf,
    professionalIds,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? MESSAGES.generic, values };
  }

  const user = { userId: staff.userId };
  const { id, ...input } = parsed.data;
  const result = id ? await updatePatient(user, { ...input, id }) : await createPatient(user, input);
  if (!result.ok) return { error: failureMessage(result), values };

  revalidatePatients();
  return { success: true };
}

export type PatientSearchState =
  | { term: string; items: PatientListItem[]; truncated: boolean }
  | undefined;

const SEARCH_MAX = 100;

/**
 * Busca por POST (Server Action), não por `?q=` na URL: o termo pode ser um CPF ou um nome, e a URL
 * vai para o histórico do navegador e para os logs de acesso. O profissional também busca (só enxerga
 * os pacientes dele, pela RLS); o usuário vem da sessão.
 */
export async function searchPatients(
  _prevState: PatientSearchState,
  formData: FormData,
): Promise<PatientSearchState> {
  const user = await requirePageAccess("/pacientes");
  const term = text(formData, "q").slice(0, SEARCH_MAX);
  const result = await listPatients({ userId: user.userId }, { search: term });
  return { term, ...result };
}

const toggleSchema = z.object({
  id: z.guid({ error: ID_MESSAGE }),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export async function setPatientActiveAction(formData: FormData): Promise<void> {
  const staff = await requireRole("admin", "reception");
  const parsed = toggleSchema.safeParse({ id: text(formData, "id"), active: text(formData, "active") });
  if (!parsed.success) return;
  await setPatientActive({ userId: staff.userId }, parsed.data.id, parsed.data.active);
  // Atualiza a tela mesmo se o banco recusou (ex.: outro usuário removeu antes): mostra o estado real.
  revalidatePatients();
}

const removeSchema = z.object({ id: z.guid({ error: ID_MESSAGE }) });

/** Remoção lógica: SÓ o admin (a recepção não remove, nem por chamada direta). */
export async function removePatientAction(formData: FormData): Promise<void> {
  const admin = await requireRole("admin");
  const parsed = removeSchema.safeParse({ id: text(formData, "id") });
  if (!parsed.success) return;
  await removePatient({ userId: admin.userId }, parsed.data.id);
  revalidatePatients();
  // A página do paciente removido deixa de existir: volta para a lista (que mostra o estado real).
  redirect("/pacientes");
}
