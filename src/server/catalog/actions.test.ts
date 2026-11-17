import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  revalidatePath: vi.fn(),
  createService: vi.fn(),
  updateService: vi.fn(),
  setServiceActive: vi.fn(),
  createInsurance: vi.fn(),
  updateInsurance: vi.fn(),
  setInsuranceActive: vi.fn(),
  setPrice: vi.fn(),
  removePrice: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("@/server/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./mutations", () => ({
  createService: mocks.createService,
  updateService: mocks.updateService,
  setServiceActive: mocks.setServiceActive,
  createInsurance: mocks.createInsurance,
  updateInsurance: mocks.updateInsurance,
  setInsuranceActive: mocks.setInsuranceActive,
  setPrice: mocks.setPrice,
  removePrice: mocks.removePrice,
}));

import {
  removePriceAction,
  saveInsurance,
  saveService,
  setInsuranceActiveAction,
  setPriceAction,
  setServiceActiveAction,
} from "./actions";

const ADMIN = { userId: "11111111-1111-4111-8111-111111111111", role: "admin", fullName: "Admin Ficticio" };
const ID = "6f1c1b5e-8a3f-4a0e-9d57-2f6c5f0b7a11";
const OTHER = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const serviceForm = (over: Record<string, string> = {}) =>
  form({ name: "Sessao", specialty: "physiotherapy", durationMinutes: "50", ...over });

const allMutations = [
  mocks.createService,
  mocks.updateService,
  mocks.setServiceActive,
  mocks.createInsurance,
  mocks.updateInsurance,
  mocks.setInsuranceActive,
  mocks.setPrice,
  mocks.removePrice,
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue(ADMIN);
  for (const fn of allMutations) fn.mockResolvedValue({ ok: true, id: ID });
});

/** Cada ação, chamada com entrada VÁLIDA, para os testes que valem para todas. */
const actions: Array<[string, () => Promise<unknown>]> = [
  ["saveService", () => saveService(undefined, serviceForm())],
  ["setServiceActiveAction", () => setServiceActiveAction(form({ id: ID, active: "false" }))],
  ["saveInsurance", () => saveInsurance(undefined, form({ name: "Plano" }))],
  ["setInsuranceActiveAction", () => setInsuranceActiveAction(form({ id: ID, active: "true" }))],
  ["setPriceAction", () => setPriceAction(undefined, form({ serviceId: ID, insuranceId: "", price: "10" }))],
  ["removePriceAction", () => removePriceAction(form({ id: ID }))],
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

describe("saveService", () => {
  it("sem id cria com os dados validados (nome aparado, duração em número) e atualiza a tela", async () => {
    const result = await saveService(undefined, serviceForm({ name: "  Sessao   de pilates " }));
    expect(result).toEqual({ success: true });
    expect(mocks.createService).toHaveBeenCalledWith(
      { userId: ADMIN.userId },
      { name: "Sessao de pilates", specialty: "physiotherapy", durationMinutes: 50 },
    );
    expect(mocks.updateService).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/servicos");
  });

  it("com id edita", async () => {
    await saveService(undefined, serviceForm({ id: ID }));
    expect(mocks.updateService).toHaveBeenCalledWith(
      { userId: ADMIN.userId },
      { id: ID, name: "Sessao", specialty: "physiotherapy", durationMinutes: 50 },
    );
    expect(mocks.createService).not.toHaveBeenCalled();
  });

  it.each([
    ["nome vazio", { name: "  " }, "Informe o nome."],
    ["duração fora do limite", { durationMinutes: "481" }, "A duração máxima é de 480 minutos."],
    ["especialidade inválida", { specialty: "cardiology" }, "Escolha a especialidade."],
    ["id inválido", { id: "123" }, "Registro inválido."],
  ])("entrada inválida (%s): devolve a mensagem em pt-BR e NÃO grava", async (_label, over, message) => {
    const result = await saveService(undefined, serviceForm(over));
    expect(result?.error).toBeTruthy();
    expect(result?.error).toBe(message);
    // devolve o que foi digitado, para a tela não apagar o formulário
    expect(result?.values).toMatchObject({ specialty: (over as Record<string, string>).specialty ?? "physiotherapy" });
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("campos ausentes não estouram (FormData vazio)", async () => {
    const result = await saveService(undefined, new FormData());
    expect(result?.error).toBeTruthy();
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate", "Já existe um serviço com esse nome nessa especialidade."],
    ["not-found", "Registro não encontrado. Atualize a página e tente de novo."],
    ["denied", "Não foi possível salvar. Atualize a página e tente de novo."],
  ] as const)("falha '%s' do banco vira mensagem fixa, sem texto técnico, e não revalida", async (reason, message) => {
    mocks.createService.mockResolvedValue({ ok: false, reason });
    expect(await saveService(undefined, serviceForm())).toEqual({
      error: message,
      values: { name: "Sessao", specialty: "physiotherapy", durationMinutes: "50" },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("saveInsurance", () => {
  it("cria e edita", async () => {
    expect(await saveInsurance(undefined, form({ name: " Plano  Ficticio " }))).toEqual({ success: true });
    expect(mocks.createInsurance).toHaveBeenCalledWith({ userId: ADMIN.userId }, { name: "Plano Ficticio" });
    await saveInsurance(undefined, form({ id: ID, name: "Plano" }));
    expect(mocks.updateInsurance).toHaveBeenCalledWith({ userId: ADMIN.userId }, { id: ID, name: "Plano" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/convenios");
  });

  it("nome vazio não grava; duplicado devolve a mensagem do convênio", async () => {
    expect((await saveInsurance(undefined, form({ name: "" })))?.error).toBe("Informe o nome.");
    expect(mocks.createInsurance).not.toHaveBeenCalled();
    mocks.createInsurance.mockResolvedValue({ ok: false, reason: "duplicate" });
    expect(await saveInsurance(undefined, form({ name: "Plano" }))).toEqual({
      error: "Já existe um convênio com esse nome.",
      values: { name: "Plano" },
    });
  });
});

describe("ativar e desativar", () => {
  it("serviço: valida o id e o 'active', grava e atualiza /servicos", async () => {
    await setServiceActiveAction(form({ id: ID, active: "false" }));
    expect(mocks.setServiceActive).toHaveBeenCalledWith({ userId: ADMIN.userId }, ID, false);
    await setServiceActiveAction(form({ id: ID, active: "true" }));
    expect(mocks.setServiceActive).toHaveBeenLastCalledWith({ userId: ADMIN.userId }, ID, true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/servicos");
  });

  it.each([
    [{ id: "x", active: "true" }],
    [{ id: ID, active: "talvez" }],
    [{ id: ID }],
    [{}],
  ])("entrada inválida %j: não grava", async (fields) => {
    await setServiceActiveAction(form(fields));
    await setInsuranceActiveAction(form(fields));
    expect(mocks.setServiceActive).not.toHaveBeenCalled();
    expect(mocks.setInsuranceActive).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("se o banco recusa (já removido por outro admin), a tela é atualizada do mesmo jeito", async () => {
    mocks.setServiceActive.mockResolvedValue({ ok: false, reason: "not-found" });
    await setServiceActiveAction(form({ id: ID, active: "false" }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/servicos");
    mocks.revalidatePath.mockClear();
    mocks.setInsuranceActive.mockResolvedValue({ ok: false, reason: "not-found" });
    await setInsuranceActiveAction(form({ id: ID, active: "false" }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/convenios");
    mocks.revalidatePath.mockClear();
    mocks.removePrice.mockResolvedValue({ ok: false, reason: "not-found" });
    await removePriceAction(form({ id: ID }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/servicos");
  });

  it("convênio: grava e atualiza /convenios", async () => {
    await setInsuranceActiveAction(form({ id: ID, active: "false" }));
    expect(mocks.setInsuranceActive).toHaveBeenCalledWith({ userId: ADMIN.userId }, ID, false);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/convenios");
  });
});

describe("valores", () => {
  it("particular: convênio vazio vira null e o valor em reais vira centavos", async () => {
    const result = await setPriceAction(undefined, form({ serviceId: ID, insuranceId: "", price: "R$ 150,50" }));
    expect(result).toEqual({ success: true });
    expect(mocks.setPrice).toHaveBeenCalledWith(
      { userId: ADMIN.userId },
      { serviceId: ID, insuranceId: null, priceCents: 15050 },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/servicos");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/convenios", "layout");
  });

  it("de convênio: guarda o convênio", async () => {
    await setPriceAction(undefined, form({ serviceId: ID, insuranceId: OTHER, price: "90" }));
    expect(mocks.setPrice).toHaveBeenCalledWith(
      { userId: ADMIN.userId },
      { serviceId: ID, insuranceId: OTHER, priceCents: 9000 },
    );
  });

  it.each([
    ["valor vazio", { price: "" }],
    ["valor negativo", { price: "-5" }],
    ["valor com 3 casas", { price: "1,999" }],
    ["valor acima do teto", { price: "100.000,01" }],
    ["serviço inválido", { serviceId: "x" }],
    ["convênio inválido", { insuranceId: "x" }],
  ])("%s: devolve erro e NÃO grava", async (_label, over) => {
    const result = await setPriceAction(undefined, form({ serviceId: ID, insuranceId: "", price: "10", ...over }));
    expect(result?.error).toBeTruthy();
    expect(result?.values).toEqual({ price: (over as Record<string, string>).price ?? "10" }); // o campo não é apagado
    expect(mocks.setPrice).not.toHaveBeenCalled();
  });

  it("falha do banco vira mensagem fixa", async () => {
    mocks.setPrice.mockResolvedValue({ ok: false, reason: "denied" });
    expect(await setPriceAction(undefined, form({ serviceId: ID, insuranceId: "", price: "10" }))).toEqual({
      error: "Não foi possível salvar. Atualize a página e tente de novo.",
      values: { price: "10" },
    });
  });

  it("remover: valida o id, remove e atualiza as telas; id inválido não remove", async () => {
    await removePriceAction(form({ id: ID }));
    expect(mocks.removePrice).toHaveBeenCalledWith({ userId: ADMIN.userId }, ID);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/servicos");
    mocks.removePrice.mockClear();
    await removePriceAction(form({ id: "x" }));
    expect(mocks.removePrice).not.toHaveBeenCalled();
  });
});
