import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  revalidatePath: vi.fn(),
  createProfessional: vi.fn(),
  updateProfessional: vi.fn(),
  setProfessionalActive: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("@/server/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./mutations", () => ({
  createProfessional: mocks.createProfessional,
  updateProfessional: mocks.updateProfessional,
  setProfessionalActive: mocks.setProfessionalActive,
}));

import { saveProfessional, setProfessionalActiveAction } from "./actions";

const ADMIN = { userId: "11111111-1111-4111-8111-111111111111", role: "admin", fullName: "Admin Ficticio" };
const ID = "6f1c1b5e-8a3f-4a0e-9d57-2f6c5f0b7a11";
const S1 = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const S2 = "9c2d4e6f-1a3b-4c5d-8e7f-0a1b2c3d4e5f";
const PROFILE = "33333333-3333-4333-8333-333333333333";

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
};
const professionalForm = (over: Record<string, string | string[]> = {}) =>
  form({
    fullName: "Ana Ficticia",
    specialty: "physiotherapy",
    registration: "",
    phone: "",
    email: "",
    profileId: "",
    serviceIds: [],
    ...over,
  });

const allMutations = [mocks.createProfessional, mocks.updateProfessional, mocks.setProfessionalActive];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue(ADMIN);
  for (const fn of allMutations) fn.mockResolvedValue({ ok: true, id: ID });
});

const actions: Array<[string, () => Promise<unknown>]> = [
  ["saveProfessional", () => saveProfessional(undefined, professionalForm())],
  ["setProfessionalActiveAction", () => setProfessionalActiveAction(form({ id: ID, active: "false" }))],
];

describe("todas as ações exigem administrador ANTES de qualquer coisa", () => {
  it.each(actions)("%s: pede requireRole('admin') e, se recusar, não grava nem revalida", async (_name, run) => {
    mocks.requireRole.mockImplementation(async () => {
      throw new RedirectSignal("/dashboard?acesso=negado");
    });
    await expect(run()).rejects.toBeInstanceOf(RedirectSignal);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(actions)("%s: com admin, chama requireRole('admin') e grava", async (_name, run) => {
    await run();
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
    expect(allMutations.some((fn) => fn.mock.calls.length > 0)).toBe(true);
  });
});

describe("saveProfessional", () => {
  it("sem id cria, com os dados validados (telefone em dígitos, e-mail em minúsculas, serviços sem repetição)", async () => {
    const result = await saveProfessional(
      undefined,
      professionalForm({
        fullName: "  Ana   Ficticia ",
        registration: " CREFITO 12345 ",
        phone: "(11) 91234-5678",
        email: "Ana@Clinica.Teste",
        profileId: PROFILE,
        serviceIds: [S1, S2, S1],
      }),
    );
    expect(result).toEqual({ success: true });
    expect(mocks.createProfessional).toHaveBeenCalledWith(
      { userId: ADMIN.userId },
      {
        fullName: "Ana Ficticia",
        specialty: "physiotherapy",
        registration: "CREFITO 12345",
        phone: "11912345678",
        email: "ana@clinica.teste",
        profileId: PROFILE,
        serviceIds: [S1, S2],
      },
    );
    expect(mocks.updateProfessional).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profissionais");
  });

  it("com id edita", async () => {
    await saveProfessional(undefined, professionalForm({ id: ID, serviceIds: [S1] }));
    expect(mocks.updateProfessional).toHaveBeenCalledWith(
      { userId: ADMIN.userId },
      expect.objectContaining({ id: ID, serviceIds: [S1], registration: null, phone: null, email: null, profileId: null }),
    );
    expect(mocks.createProfessional).not.toHaveBeenCalled();
  });

  it.each([
    ["nome vazio", { fullName: " " }, "Informe o nome."],
    ["especialidade inválida", { specialty: "cardiology" }, "Escolha a especialidade."],
    ["registro curto", { registration: "12" }, "O registro deve ter de 3 a 30 caracteres."],
    ["telefone inválido", { phone: "123" }, "Informe o telefone com DDD, como (11) 91234-5678."],
    ["e-mail inválido", { email: "ana@" }, "Informe um e-mail válido."],
    ["login inválido", { profileId: "x" }, "Login inválido."],
    ["serviço inválido", { serviceIds: [S1, "x"] }, "Serviço inválido."],
    ["id inválido", { id: "123" }, "Registro inválido."],
  ])("entrada inválida (%s): mensagem em pt-BR, devolve o que foi digitado e NÃO grava", async (_label, over, message) => {
    const result = await saveProfessional(undefined, professionalForm(over));
    expect(result?.error).toBe(message);
    expect(result?.values).toMatchObject({ fullName: expect.any(String), specialty: expect.any(String) });
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("devolve os serviços marcados (lista junta por vírgula) para a tela não apagar as marcações", async () => {
    const result = await saveProfessional(undefined, professionalForm({ phone: "123", serviceIds: [S1, S2] }));
    expect(result?.values?.serviceIds).toBe(`${S1},${S2}`);
    expect(result?.values?.phone).toBe("123");
  });

  it("formulário vazio não estoura", async () => {
    const result = await saveProfessional(undefined, new FormData());
    expect(result?.error).toBeTruthy();
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate-name", "Já existe um profissional com esse nome nessa especialidade."],
    ["duplicate-login", "Este login já está vinculado a outro profissional."],
    ["not-found", "Registro não encontrado. Atualize a página e tente de novo."],
    [
      "denied",
      "Não foi possível salvar. Confira o login e os serviços escolhidos (devem ser da mesma especialidade) e tente de novo. Quem já tem atendimentos não pode trocar de especialidade.",
    ],
  ] as const)("falha '%s' do banco vira mensagem fixa, sem texto técnico, e não revalida", async (reason, message) => {
    mocks.createProfessional.mockResolvedValue({ ok: false, reason });
    const result = await saveProfessional(undefined, professionalForm());
    expect(result?.error).toBe(message);
    expect(result?.values?.fullName).toBe("Ana Ficticia");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("setProfessionalActiveAction", () => {
  it("valida o id e o 'active', grava e atualiza /profissionais", async () => {
    await setProfessionalActiveAction(form({ id: ID, active: "false" }));
    expect(mocks.setProfessionalActive).toHaveBeenCalledWith({ userId: ADMIN.userId }, ID, false);
    await setProfessionalActiveAction(form({ id: ID, active: "true" }));
    expect(mocks.setProfessionalActive).toHaveBeenLastCalledWith({ userId: ADMIN.userId }, ID, true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profissionais");
  });

  it.each([[{ id: "x", active: "true" }], [{ id: ID, active: "talvez" }], [{ id: ID }], [{}]])(
    "entrada inválida %j: não grava",
    async (fields) => {
      await setProfessionalActiveAction(form(fields));
      expect(mocks.setProfessionalActive).not.toHaveBeenCalled();
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("se o banco recusa (removido por outro admin), a tela é atualizada do mesmo jeito", async () => {
    mocks.setProfessionalActive.mockResolvedValue({ ok: false, reason: "not-found" });
    await setProfessionalActiveAction(form({ id: ID, active: "false" }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profissionais");
  });
});
