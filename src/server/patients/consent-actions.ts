"use server";

import { revalidatePath } from "next/cache";

import { todayBR } from "@/lib/datetime";
import { createConsentInputSchema } from "@/lib/patients/consents";
import { requireRole } from "@/server/auth/session";
import type { CatalogFormState } from "@/server/catalog/actions";

import { registerConsent } from "./consent-mutations";

/**
 * Server Action de consentimento LGPD (1B-3b). Regras:
 * - Começa com `requireRole("admin", "reception")`, antes de ler a entrada: o profissional nunca
 *   registra nem vê consentimento. O `proxy` deixa passar o POST de uma ação: a proteção é daqui
 *   (`server-actions-guard.test.ts` confere).
 * - O usuário (quem registrou) vem da SESSÃO, nunca do formulário; o banco carimba quando.
 * - Entrada validada com Zod (`src/lib/patients/consents.ts`); mensagens fixas em pt-BR, nunca texto
 *   do banco nem o que foi digitado na nota.
 * - Em ERRO devolve também os valores digitados (o React limpa o formulário depois de cada ação).
 * DADO SENSÍVEL: nada daqui é logado.
 */
export type ConsentFormState = CatalogFormState;

const MESSAGES = {
  generic: "Não foi possível concluir. Tente novamente.",
  denied: "Não foi possível registrar o consentimento. Atualize a página e tente de novo.",
} as const;

const FIELDS = ["patientId", "kind", "granted", "givenBy", "method", "occurredOn", "note"] as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function registerConsentAction(
  _prevState: ConsentFormState,
  formData: FormData,
): Promise<ConsentFormState> {
  const staff = await requireRole("admin", "reception");
  const values = Object.fromEntries(FIELDS.map((name) => [name, text(formData, name)])) as Record<
    (typeof FIELDS)[number],
    string
  >;

  const parsed = createConsentInputSchema(todayBR()).safeParse(values);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? MESSAGES.generic, values };
  }

  const result = await registerConsent({ userId: staff.userId }, parsed.data);
  if (!result.ok) return { error: MESSAGES.denied, values };

  revalidatePath("/pacientes");
  revalidatePath("/pacientes/[id]", "page");
  return { success: true };
}
