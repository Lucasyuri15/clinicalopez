import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  registerConsent: vi.fn(),
  revalidatePath: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("@/server/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./consent-mutations", () => ({ registerConsent: mocks.registerConsent }));

import { registerConsentAction } from "./consent-actions";

const ADMIN = { userId: "11111111-1111-4111-8111-111111111111", role: "admin", fullName: "Admin Ficticio" };
const RECEPTION = { userId: "22222222-2222-4222-8222-222222222222", role: "reception", fullName: "Recepcao Ficticia" };
const PATIENT = "6f1c1b5e-8a3f-4a0e-9d57-2f6c5f0b7a11";
const OTHER_USER = "99999999-9999-4999-8999-999999999999";

const form = (over: Record<string, string> = {}) => {
  const data = new FormData();
  const fields: Record<string, string> = {
    patientId: PATIENT,
    kind: "data_processing",
    granted: "true",
    givenBy: "patient",
    method: "signed_paper",
    occurredOn: "2020-01-15",
    note: "",
    ...over,
  };
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue(RECEPTION);
  mocks.registerConsent.mockResolvedValue({ ok: true, id: "c1" });
});

describe("registerConsentAction", () => {
  it("exige admin ou recepção ANTES de qualquer coisa; recusado, não grava nem revalida", async () => {
    mocks.requireRole.mockImplementation(async () => {
      throw new RedirectSignal("/dashboard?acesso=negado");
    });
    await expect(registerConsentAction(undefined, form())).rejects.toBeInstanceOf(RedirectSignal);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "reception");
    expect(mocks.requireRole.mock.calls.flat()).not.toContain("professional");
    expect(mocks.registerConsent).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("registra com o usuário da SESSÃO, ignorando qualquer usuário informado no formulário", async () => {
    mocks.requireRole.mockResolvedValue(ADMIN);
    const data = form();
    data.append("userId", OTHER_USER);
    data.append("registeredBy", OTHER_USER);
    expect(await registerConsentAction(undefined, data)).toEqual({ success: true });
    expect(mocks.registerConsent).toHaveBeenCalledTimes(1);
    const [user, input] = mocks.registerConsent.mock.calls[0]!;
    expect(user).toEqual({ userId: ADMIN.userId });
    expect(input).toEqual({
      patientId: PATIENT,
      kind: "data_processing",
      granted: true,
      givenBy: "patient",
      method: "signed_paper",
      occurredOn: "2020-01-15",
      note: null,
    });
    expect(input).not.toHaveProperty("registeredBy");
    expect(input).not.toHaveProperty("createdAt");
  });

  it("sucesso atualiza a lista (selo) e o detalhe do paciente", async () => {
    await registerConsentAction(undefined, form());
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pacientes");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pacientes/[id]", "page");
  });

  it("valida a entrada: mensagem fixa em pt-BR, devolve o digitado e não grava", async () => {
    const result = await registerConsentAction(undefined, form({ method: "", note: "Combinado por telefone" }));
    expect(result).toMatchObject({
      error: "Informe como o consentimento foi obtido.",
      values: { method: "", note: "Combinado por telefone", patientId: PATIENT },
    });
    expect(mocks.registerConsent).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("recusa data futura sem gravar", async () => {
    const result = await registerConsentAction(undefined, form({ occurredOn: "2999-01-01" }));
    expect(result).toMatchObject({ error: "A data do consentimento não pode ser no futuro." });
    expect(mocks.registerConsent).not.toHaveBeenCalled();
  });

  it("revogação vira granted: false", async () => {
    await registerConsentAction(undefined, form({ granted: "false", note: "Pediu para não receber mensagens" }));
    expect(mocks.registerConsent.mock.calls[0]![1]).toMatchObject({
      granted: false,
      note: "Pediu para não receber mensagens",
    });
  });

  it("o banco recusou (paciente removido, sem permissão): mensagem genérica, sem eco da nota nem revalidar", async () => {
    mocks.registerConsent.mockResolvedValue({ ok: false, reason: "denied" });
    const result = await registerConsentAction(undefined, form({ note: "texto sensível do paciente" }));
    expect(result).toMatchObject({
      error: "Não foi possível registrar o consentimento. Atualize a página e tente de novo.",
    });
    expect(JSON.stringify((result as { error?: string }).error)).not.toContain("sensível");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("campos ausentes viram erro de validação, não exceção", async () => {
    const result = await registerConsentAction(undefined, new FormData());
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(mocks.registerConsent).not.toHaveBeenCalled();
  });
});
