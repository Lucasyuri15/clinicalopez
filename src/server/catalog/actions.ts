"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  insuranceInputSchema,
  priceInputSchema,
  serviceInputSchema,
} from "@/lib/catalog/schemas";
import { requireRole } from "@/server/auth/session";

import {
  createInsurance,
  createService,
  removePrice,
  setInsuranceActive,
  setPrice,
  setServiceActive,
  updateInsurance,
  updateService,
  type MutationResult,
} from "./mutations";

/**
 * Server Actions do catálogo (serviços, convênios e valores). Regras:
 * - TODAS começam com `requireRole("admin")`, antes de ler a entrada (o `proxy` deixa passar o
 *   POST de uma ação: a proteção é daqui; `server-actions-guard.test.ts` confere).
 * - Entrada validada com Zod (`src/lib/catalog/schemas.ts`); mensagens fixas em pt-BR, nunca
 *   texto do banco.
 * - Só administradores gravam; a RLS é a segunda camada (recepção e profissional nunca gravam).
 */
export type CatalogFormState =
  | {
      error?: string;
      success?: true;
      /**
       * O que foi digitado, devolvido junto com um ERRO: o React limpa o formulário depois de cada
       * ação, e a tela usa estes valores como valor inicial dos campos para ninguém redigitar tudo.
       */
      values?: Record<string, string>;
    }
  | undefined;

const MESSAGES = {
  generic: "Não foi possível concluir. Tente novamente.",
  notFound: "Registro não encontrado. Atualize a página e tente de novo.",
  denied: "Não foi possível salvar. Atualize a página e tente de novo.",
  deniedServiceEdit:
    "Não foi possível salvar. Se este serviço já está ligado a profissionais, desligue-o deles antes de trocar a especialidade.",
  duplicateService: "Já existe um serviço com esse nome nessa especialidade.",
  duplicateInsurance: "Já existe um convênio com esse nome.",
  duplicatePrice: "Outra pessoa alterou este valor. Atualize a página e tente de novo.",
} as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? MESSAGES.generic;
}

function failureMessage(
  result: Extract<MutationResult, { ok: false }>,
  duplicate: string,
): string {
  switch (result.reason) {
    case "duplicate":
      return duplicate;
    case "not-found":
      return MESSAGES.notFound;
    case "denied":
      return MESSAGES.denied;
  }
}

const idSchema = z.guid({ error: "Registro inválido." });

const toggleSchema = z.object({
  id: idSchema,
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export async function saveService(
  _prevState: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const admin = await requireRole("admin");
  const values = {
    name: text(formData, "name"),
    specialty: text(formData, "specialty"),
    durationMinutes: text(formData, "durationMinutes"),
  };
  const parsed = serviceInputSchema.safeParse({ id: text(formData, "id") || undefined, ...values });
  if (!parsed.success) return { error: firstError(parsed.error), values };

  const user = { userId: admin.userId };
  const { id, ...fields } = parsed.data;
  const result = id
    ? await updateService(user, { ...fields, id })
    : await createService(user, fields);
  if (!result.ok) {
    // Ao EDITAR, a recusa do banco costuma ser a troca de especialidade de um serviço já ligado a
    // profissionais (a chave estrangeira composta não deixa): diz o motivo provável.
    const error =
      id && result.reason === "denied"
        ? MESSAGES.deniedServiceEdit
        : failureMessage(result, MESSAGES.duplicateService);
    return { error, values };
  }

  revalidatePath("/servicos");
  return { success: true };
}

export async function setServiceActiveAction(formData: FormData): Promise<void> {
  const admin = await requireRole("admin");
  const parsed = toggleSchema.safeParse({
    id: text(formData, "id"),
    active: text(formData, "active"),
  });
  if (!parsed.success) return;
  await setServiceActive({ userId: admin.userId }, parsed.data.id, parsed.data.active);
  // Atualiza a tela mesmo se o banco recusou (ex.: outro admin removeu antes): mostra o estado real.
  revalidatePath("/servicos");
}

export async function saveInsurance(
  _prevState: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const admin = await requireRole("admin");
  const values = { name: text(formData, "name") };
  const parsed = insuranceInputSchema.safeParse({ id: text(formData, "id") || undefined, ...values });
  if (!parsed.success) return { error: firstError(parsed.error), values };

  const user = { userId: admin.userId };
  const { id, ...fields } = parsed.data;
  const result = id
    ? await updateInsurance(user, { ...fields, id })
    : await createInsurance(user, fields);
  if (!result.ok) return { error: failureMessage(result, MESSAGES.duplicateInsurance), values };

  revalidatePath("/convenios");
  return { success: true };
}

export async function setInsuranceActiveAction(formData: FormData): Promise<void> {
  const admin = await requireRole("admin");
  const parsed = toggleSchema.safeParse({
    id: text(formData, "id"),
    active: text(formData, "active"),
  });
  if (!parsed.success) return;
  await setInsuranceActive({ userId: admin.userId }, parsed.data.id, parsed.data.active);
  revalidatePath("/convenios");
}

/** Os valores aparecem em /servicos (particular) e em /convenios/[id] (por convênio). */
function revalidatePrices() {
  revalidatePath("/servicos");
  revalidatePath("/convenios", "layout");
}

export async function setPriceAction(
  _prevState: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const admin = await requireRole("admin");
  const values = { price: text(formData, "price") };
  const parsed = priceInputSchema.safeParse({
    serviceId: text(formData, "serviceId"),
    insuranceId: text(formData, "insuranceId"),
    ...values,
  });
  if (!parsed.success) return { error: firstError(parsed.error), values };

  const result = await setPrice({ userId: admin.userId }, parsed.data);
  if (!result.ok) return { error: failureMessage(result, MESSAGES.duplicatePrice), values };

  revalidatePrices();
  return { success: true };
}

export async function removePriceAction(formData: FormData): Promise<void> {
  const admin = await requireRole("admin");
  const parsed = idSchema.safeParse(text(formData, "id"));
  if (!parsed.success) return;
  await removePrice({ userId: admin.userId }, parsed.data);
  revalidatePrices();
}
