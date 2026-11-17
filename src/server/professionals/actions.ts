"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ID_MESSAGE } from "@/lib/catalog/schemas";
import { professionalInputSchema } from "@/lib/professionals/schemas";
import { requireRole } from "@/server/auth/session";
import type { CatalogFormState } from "@/server/catalog/actions";

import {
  createProfessional,
  setProfessionalActive,
  updateProfessional,
  type ProfessionalResult,
} from "./mutations";

/**
 * Server Actions dos profissionais. Regras:
 * - TODAS começam com `requireRole("admin")`, antes de ler a entrada (o `proxy` deixa passar o
 *   POST de uma ação: a proteção é daqui; `server-actions-guard.test.ts` confere).
 * - Entrada validada com Zod (`src/lib/professionals/schemas.ts`); mensagens fixas em pt-BR,
 *   nunca texto do banco.
 * - Em ERRO devolvem também os valores digitados: o React limpa o formulário depois de cada
 *   ação, e a tela os usa como valor inicial para ninguém redigitar tudo.
 */
export type ProfessionalFormState = CatalogFormState;

const MESSAGES = {
  generic: "Não foi possível concluir. Tente novamente.",
  notFound: "Registro não encontrado. Atualize a página e tente de novo.",
  denied:
    "Não foi possível salvar. Confira o login e os serviços escolhidos (devem ser da mesma especialidade) e tente de novo.",
  duplicateName: "Já existe um profissional com esse nome nessa especialidade.",
  duplicateLogin: "Este login já está vinculado a outro profissional.",
} as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Todos os valores de um campo repetido (caixas de seleção), só os que são texto. */
function texts(formData: FormData, name: string): string[] {
  return formData.getAll(name).filter((value): value is string => typeof value === "string");
}

function failureMessage(result: Extract<ProfessionalResult, { ok: false }>): string {
  switch (result.reason) {
    case "duplicate-name":
      return MESSAGES.duplicateName;
    case "duplicate-login":
      return MESSAGES.duplicateLogin;
    case "not-found":
      return MESSAGES.notFound;
    case "denied":
      return MESSAGES.denied;
  }
}

export async function saveProfessional(
  _prevState: ProfessionalFormState,
  formData: FormData,
): Promise<ProfessionalFormState> {
  const admin = await requireRole("admin");
  const serviceIds = texts(formData, "serviceIds");
  const values = {
    fullName: text(formData, "fullName"),
    specialty: text(formData, "specialty"),
    registration: text(formData, "registration"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    profileId: text(formData, "profileId"),
    serviceIds: serviceIds.join(","),
  };
  const parsed = professionalInputSchema.safeParse({
    id: text(formData, "id") || undefined,
    ...values,
    serviceIds,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? MESSAGES.generic, values };
  }

  const user = { userId: admin.userId };
  const { id, ...fields } = parsed.data;
  const result = id ? await updateProfessional(user, { ...fields, id }) : await createProfessional(user, fields);
  if (!result.ok) return { error: failureMessage(result), values };

  revalidatePath("/profissionais");
  return { success: true };
}

const toggleSchema = z.object({
  id: z.guid({ error: ID_MESSAGE }),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export async function setProfessionalActiveAction(formData: FormData): Promise<void> {
  const admin = await requireRole("admin");
  const parsed = toggleSchema.safeParse({ id: text(formData, "id"), active: text(formData, "active") });
  if (!parsed.success) return;
  await setProfessionalActive({ userId: admin.userId }, parsed.data.id, parsed.data.active);
  // Atualiza a tela mesmo se o banco recusou (ex.: outro admin removeu antes): mostra o estado real.
  revalidatePath("/profissionais");
}
