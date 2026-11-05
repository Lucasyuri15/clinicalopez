"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { toSvgDataUri } from "@/lib/auth/qr";
import { loginSchema, totpCodeSchema } from "@/lib/auth/schemas";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import {
  readAuthStep,
  STEP_PATHS,
  type SupabaseServerClient,
} from "./mfa-step";

/**
 * Server Actions de autenticação. Regras:
 * - Mensagens SEMPRE genéricas (sem enumerar usuários, sem vazar texto do Supabase).
 * - Todas as ações de 2FA revalidam sessão e passo no servidor (a UI não é confiável).
 * - Só LEEM a sessão; a renovação do token é do `proxy`.
 */

export type FormState = { error?: string } | undefined;

export type EnrollStartResult =
  | { ok: true; factorId: string; qrCode: string; secret: string }
  | { ok: false; error: string };

const MESSAGES = {
  invalidCredentials: "E-mail ou senha incorretos.",
  rateLimited: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  invalidCode:
    "Código inválido ou expirado. Confira o app autenticador e tente de novo.",
  enrollFailed: "Não foi possível gerar o QR Code. Tente novamente.",
  generic: "Não foi possível concluir. Tente novamente.",
} as const;

const factorIdSchema = z.guid();

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function isRateLimited(error: { status?: number } | null): boolean {
  return error?.status === 429;
}

/**
 * Exige sessão e que o usuário esteja exatamente no passo esperado; senão,
 * redireciona para onde ele deveria estar (impede, por ex., cadastrar um segundo
 * fator usando só a senha).
 */
async function requireStep(
  supabase: SupabaseServerClient,
  expected: "mfa-enroll" | "mfa-verify",
): Promise<void> {
  const step = await readAuthStep(supabase);
  if (step === null) redirect("/mfa");
  if (step !== expected) redirect(STEP_PATHS[step]);
}

export async function login(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: text(formData, "email"),
    password: text(formData, "password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? MESSAGES.generic };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return {
      error: isRateLimited(error)
        ? MESSAGES.rateLimited
        : MESSAGES.invalidCredentials,
    };
  }

  const step = await readAuthStep(supabase);
  redirect(step === null ? "/mfa" : STEP_PATHS[step]);
}

export async function startMfaEnroll(): Promise<EnrollStartResult> {
  const supabase = await createSupabaseServerClient();
  await requireStep(supabase, "mfa-enroll");

  // Remove tentativas antigas não concluídas (ficam acumulando se o usuário recarrega a página).
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "López + Saúde",
  });
  const qrCode = data ? toSvgDataUri(data.totp.qr_code) : null;
  if (error || !data || !qrCode) {
    return { ok: false, error: MESSAGES.enrollFailed };
  }

  return {
    ok: true,
    factorId: data.id,
    qrCode,
    secret: data.totp.secret,
  };
}

export async function verifyMfaEnroll(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createSupabaseServerClient();
  await requireStep(supabase, "mfa-enroll");

  const factorId = factorIdSchema.safeParse(text(formData, "factorId"));
  if (!factorId.success) return { error: MESSAGES.generic };
  const code = totpCodeSchema.safeParse(text(formData, "code"));
  if (!code.success) {
    return { error: code.error.issues[0]?.message ?? MESSAGES.invalidCode };
  }

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factorId.data,
    code: code.data,
  });
  if (error) {
    return {
      error: isRateLimited(error) ? MESSAGES.rateLimited : MESSAGES.invalidCode,
    };
  }
  redirect("/dashboard");
}

export async function verifyMfaLogin(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const supabase = await createSupabaseServerClient();
  await requireStep(supabase, "mfa-verify");

  const code = totpCodeSchema.safeParse(text(formData, "code"));
  if (!code.success) {
    return { error: code.error.issues[0]?.message ?? MESSAGES.invalidCode };
  }

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) redirect("/mfa/enroll");

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code: code.data,
  });
  if (error) {
    return {
      error: isRateLimited(error) ? MESSAGES.rateLimited : MESSAGES.invalidCode,
    };
  }
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  // Só esta sessão (não derruba o usuário em outros aparelhos).
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
