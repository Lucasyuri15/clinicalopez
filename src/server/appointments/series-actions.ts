"use server";

import { revalidatePath } from "next/cache";

import {
  cancelAppointmentSchema,
  createSeriesSchema,
  renewSeriesSchema,
  rescheduleAppointmentSchema,
} from "@/lib/appointments/schemas";
import type { OccurrenceReason } from "@/lib/appointments/series";
import { requireRole } from "@/server/auth/session";

import { FAILURE_MESSAGES } from "./messages";
import {
  cancelSeriesFrom,
  createSeries,
  previewRenewal,
  previewSeries,
  renewSeries,
  rescheduleSeriesFrom,
} from "./series-mutations";

/**
 * Server Actions das séries (Fase 3A). Regras:
 * - TODAS começam com `requireRole("admin", "reception")`, antes de ler a entrada: série é gestão da
 *   recepção, o profissional nunca cria, renova, cancela nem remarca uma. O `proxy` deixa passar o POST
 *   de uma ação: a proteção é daqui (`server-actions-guard.test.ts` confere).
 * - O usuário vem da SESSÃO, nunca do formulário; as datas são calculadas e validadas no servidor
 *   (`createSeriesSchema` / `renewSeriesSchema`): a tela só pede o padrão, nunca manda instantes.
 * - As duas "prévias" só LEEM (nada é gravado e nada é revalidado).
 * - Mensagens fixas em pt-BR, nunca texto do banco nem o motivo digitado no cancelamento (texto livre).
 * - Em ERRO devolvem também os valores digitados (o React limpa o formulário depois de cada ação).
 * Datas voltam como texto ISO (instante UTC): a tela formata em Brasília.
 * DADO SENSÍVEL: nada daqui é logado.
 */

/** Uma data da série: `reason` nulo = cabe; senão, o motivo pelo qual não cabe. */
export type SeriesRow = { startsAt: string; reason: OccurrenceReason | null };
/** Uma sessão que NÃO foi movida: continua em `from`; `to` é a data para a qual não coube. */
export type UnmovedRow = { from: string; to: string; reason: OccurrenceReason };

export type SeriesFormState =
  | {
      error?: string;
      success?: true;
      values?: Record<string, string>;
      /** Prévia: uma linha por data da série. */
      preview?: SeriesRow[];
      /** Criar/renovar: quantas sessões entraram e quais datas foram puladas (com o motivo). */
      created?: number;
      skipped?: SeriesRow[];
      /** Cancelar daqui para frente: quantas sessões foram canceladas. */
      count?: number;
      /** Remarcar daqui para frente: quantas foram movidas e quais ficaram onde estavam. */
      moved?: number;
      unmoved?: UnmovedRow[];
    }
  | undefined;

const PATTERN_FIELDS = ["date", "startTime", "durationMinutes", "count"] as const;
const SERIES_FIELDS = ["patientId", "professionalId", "serviceId", ...PATTERN_FIELDS] as const;
const RENEW_FIELDS = ["seriesId", ...PATTERN_FIELDS] as const;
const RESCHEDULE_FIELDS = ["id", "date", "startTime", "durationMinutes"] as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function pick<const Names extends readonly string[]>(formData: FormData, names: Names): Record<Names[number], string> {
  return Object.fromEntries(names.map((name) => [name, text(formData, name)])) as Record<Names[number], string>;
}

/** Os dias da semana marcados (várias caixas com o mesmo nome) como lista de textos. */
const weekdaysOf = (formData: FormData): string[] =>
  formData.getAll("weekdays").filter((value): value is string => typeof value === "string");

/** Os valores digitados devolvidos em caso de erro (os dias da semana voltam juntos, separados por vírgula). */
const echo = (formData: FormData, names: readonly string[]): Record<string, string> => ({
  ...pick(formData, names),
  weekdays: weekdaysOf(formData).join(","),
});

function revalidateAgenda() {
  revalidatePath("/agenda");
  // Agendar pode criar o vínculo paciente↔profissional: a ficha do paciente muda.
  revalidatePath("/pacientes/[id]", "page");
}

const fail = (message: string | undefined, values: Record<string, string>): SeriesFormState => ({
  error: message ?? FAILURE_MESSAGES.generic,
  values,
});

const iso = (instant: Date): string => instant.toISOString();

/** Prévia de uma série NOVA: só lê. */
export async function previewSeriesAction(_prevState: SeriesFormState, formData: FormData): Promise<SeriesFormState> {
  const staff = await requireRole("admin", "reception");
  const values = echo(formData, SERIES_FIELDS);
  const parsed = createSeriesSchema().safeParse({ ...pick(formData, SERIES_FIELDS), weekdays: weekdaysOf(formData) });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);

  const result = await previewSeries({ userId: staff.userId }, parsed.data);
  if (!result.ok) return fail(FAILURE_MESSAGES[result.reason], values);
  return {
    values,
    preview: result.items.map((item) => ({ startsAt: iso(item.startsAt), reason: item.verdict.ok ? null : item.verdict.reason })),
  };
}

/** Prévia de uma RENOVAÇÃO (mais sessões numa série que já existe): só lê. */
export async function previewRenewalAction(_prevState: SeriesFormState, formData: FormData): Promise<SeriesFormState> {
  const staff = await requireRole("admin", "reception");
  const values = echo(formData, RENEW_FIELDS);
  const parsed = renewSeriesSchema().safeParse({ ...pick(formData, RENEW_FIELDS), weekdays: weekdaysOf(formData) });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);

  const result = await previewRenewal({ userId: staff.userId }, parsed.data);
  if (!result.ok) return fail(FAILURE_MESSAGES[result.reason], values);
  return {
    values,
    preview: result.items.map((item) => ({ startsAt: iso(item.startsAt), reason: item.verdict.ok ? null : item.verdict.reason })),
  };
}

/** Cria a série com as datas que cabem e devolve o resumo (quantas entraram e quais foram puladas). */
export async function createSeriesAction(_prevState: SeriesFormState, formData: FormData): Promise<SeriesFormState> {
  const staff = await requireRole("admin", "reception");
  const values = echo(formData, SERIES_FIELDS);
  const parsed = createSeriesSchema().safeParse({ ...pick(formData, SERIES_FIELDS), weekdays: weekdaysOf(formData) });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);

  const result = await createSeries({ userId: staff.userId }, parsed.data);
  if (!result.ok) return fail(FAILURE_MESSAGES[result.reason], values);
  revalidateAgenda();
  return { success: true, created: result.created.length, skipped: result.skipped.map((item) => ({ startsAt: iso(item.startsAt), reason: item.reason })) };
}

/** Renova a série (mais sessões na mesma série) e devolve o resumo. */
export async function renewSeriesAction(_prevState: SeriesFormState, formData: FormData): Promise<SeriesFormState> {
  const staff = await requireRole("admin", "reception");
  const values = echo(formData, RENEW_FIELDS);
  const parsed = renewSeriesSchema().safeParse({ ...pick(formData, RENEW_FIELDS), weekdays: weekdaysOf(formData) });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);

  const result = await renewSeries({ userId: staff.userId }, parsed.data);
  if (!result.ok) return fail(FAILURE_MESSAGES[result.reason], values);
  revalidateAgenda();
  return { success: true, created: result.created.length, skipped: result.skipped.map((item) => ({ startsAt: iso(item.startsAt), reason: item.reason })) };
}

/** Cancela, com o motivo, esta sessão e as seguintes abertas da série. */
export async function cancelSeriesFromAction(_prevState: SeriesFormState, formData: FormData): Promise<SeriesFormState> {
  const staff = await requireRole("admin", "reception");
  const values = pick(formData, ["id", "reason"] as const);
  const parsed = cancelAppointmentSchema.safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);

  const result = await cancelSeriesFrom({ userId: staff.userId }, parsed.data);
  if (!result.ok) return fail(FAILURE_MESSAGES[result.reason], values);
  revalidateAgenda();
  return { success: true, count: result.count };
}

/** Remarca esta sessão e as seguintes abertas da série; as que não couberem ficam e voltam na lista. */
export async function rescheduleSeriesFromAction(_prevState: SeriesFormState, formData: FormData): Promise<SeriesFormState> {
  const staff = await requireRole("admin", "reception");
  const values = pick(formData, RESCHEDULE_FIELDS);
  const parsed = rescheduleAppointmentSchema(new Date()).safeParse(values);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message, values);

  const result = await rescheduleSeriesFrom({ userId: staff.userId }, parsed.data);
  if (!result.ok) return fail(FAILURE_MESSAGES[result.reason], values);
  revalidateAgenda();
  return {
    success: true,
    moved: result.moved.length,
    unmoved: result.skipped.map((item) => ({ from: iso(item.from), to: iso(item.to), reason: item.reason })),
  };
}
