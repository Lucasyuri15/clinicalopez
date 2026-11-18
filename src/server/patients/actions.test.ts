import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requirePageAccess: vi.fn(),
  listPatients: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  createPatient: vi.fn(),
  updatePatient: vi.fn(),
  setPatientActive: vi.fn(),
  removePatient: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("@/server/auth/session", () => ({
  requireRole: mocks.requireRole,
  requirePageAccess: mocks.requirePageAccess,
}));
vi.mock("./queries", () => ({ listPatients: mocks.listPatients }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./mutations", () => ({
  createPatient: mocks.createPatient,
  updatePatient: mocks.updatePatient,
  setPatientActive: mocks.setPatientActive,
  removePatient: mocks.removePatient,
}));

import { removePatientAction, savePatient, searchPatients, setPatientActiveAction } from "./actions";

const ADMIN = { userId: "11111111-1111-4111-8111-111111111111", role: "admin", fullName: "Admin Ficticio" };
const RECEPTION = { userId: "22222222-2222-4222-8222-222222222222", role: "reception", fullName: "Recepcao Ficticia" };
const ID = "6f1c1b5e-8a3f-4a0e-9d57-2f6c5f0b7a11";
const P1 = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const P2 = "9c2d4e6f-1a3b-4c5d-8e7f-0a1b2c3d4e5f";
const CPF = "529.982.247-25"; // fictício, dígitos verificadores corretos

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
};
const patientForm = (over: Record<string, string | string[]> = {}) =>
  form({
    fullName: "Maria Ficticia",
    birthDate: "1990-05-10",
    phone: "(11) 91234-5678",
    email: "",
    cpf: CPF,
    noCpfReason: "",
    cep: "",
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "",
    insuranceId: "",
    insuranceCard: "",
    guardianName: "",
    guardianRelationship: "",
    guardianPhone: "",
    guardianCpf: "",
    adminNotes: "",
    professionalIds: [],
    ...over,
  });

const allMutations = [mocks.createPatient, mocks.updatePatient, mocks.setPatientActive, mocks.removePatient];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue(RECEPTION);
  for (const fn of allMutations) fn.mockResolvedValue({ ok: true, id: ID });
});

const actions: Array<[string, () => Promise<unknown>, string[]]> = [
  ["savePatient", () => savePatient(undefined, patientForm()), ["admin", "reception"]],
  ["setPatientActiveAction", () => setPatientActiveAction(form({ id: ID, active: "false" })), ["admin", "reception"]],
  ["removePatientAction", () => removePatientAction(form({ id: ID })), ["admin"]],
];

describe("todas as ações exigem o papel certo ANTES de qualquer coisa", () => {
  it.each(actions)("%s: pede requireRole e, se recusar, não grava nem revalida", async (_name, run, roles) => {
    mocks.requireRole.mockImplementation(async () => {
      throw new RedirectSignal("/dashboard?acesso=negado");
    });
    await expect(run()).rejects.toBeInstanceOf(RedirectSignal);
    expect(mocks.requireRole).toHaveBeenCalledWith(...roles);
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("cadastrar e inativar valem para admin e recepção; remover SÓ para o admin; o profissional nunca", async () => {
    await savePatient(undefined, patientForm());
    await setPatientActiveAction(form({ id: ID, active: "false" }));
    await removePatientAction(form({ id: ID }));
    const calls = mocks.requireRole.mock.calls;
    expect(calls[0]).toEqual(["admin", "reception"]);
    expect(calls[1]).toEqual(["admin", "reception"]);
    expect(calls[2]).toEqual(["admin"]);
    expect(calls.flat()).not.toContain("professional");
  });
});

describe("savePatient", () => {
  it("cria quando não há id: normaliza (CPF só dígitos, telefone só dígitos) e revalida a lista e o detalhe", async () => {
    const result = await savePatient(undefined, patientForm({ professionalIds: [P1, P2] }));
    expect(result).toEqual({ success: true });
    expect(mocks.createPatient).toHaveBeenCalledTimes(1);
    const [user, input] = mocks.createPatient.mock.calls[0]!;
    expect(user).toEqual({ userId: RECEPTION.userId });
    expect(input).toMatchObject({
      fullName: "Maria Ficticia",
      birthDate: "1990-05-10",
      phone: "11912345678",
      cpf: "52998224725",
      noCpfReason: null,
      professionalIds: [P1, P2],
    });
    expect(input).not.toHaveProperty("id");
    expect(mocks.updatePatient).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pacientes");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pacientes/[id]", "page");
  });

  it("edita quando há id", async () => {
    await savePatient(undefined, patientForm({ id: ID }));
    expect(mocks.updatePatient).toHaveBeenCalledTimes(1);
    expect(mocks.updatePatient.mock.calls[0]![1]).toMatchObject({ id: ID });
    expect(mocks.createPatient).not.toHaveBeenCalled();
  });

  it("'Sem CPF' com motivo grava o motivo e CPF nulo", async () => {
    await savePatient(undefined, patientForm({ noCpf: "on", cpf: "", noCpfReason: "Estrangeira" }));
    expect(mocks.createPatient.mock.calls[0]![1]).toMatchObject({ cpf: null, noCpfReason: "Estrangeira" });
  });

  it("entrada inválida: devolve a mensagem em português e o que foi digitado, e NÃO grava", async () => {
    const result = await savePatient(undefined, patientForm({ cpf: "529.982.247-24", fullName: "Maria Teste" }));
    expect(result).toMatchObject({ error: "CPF inválido.", values: { fullName: "Maria Teste", cpf: "529.982.247-24" } });
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("menor de idade sem responsável é recusado com mensagem clara", async () => {
    const result = await savePatient(undefined, patientForm({ birthDate: "2020-01-01" }));
    expect(result).toMatchObject({ error: expect.stringContaining("responsável") });
    expect(mocks.createPatient).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate-cpf", "Já existe um cadastro com este CPF (pode estar removido: procure o administrador)."],
    ["not-found", "Registro não encontrado. Atualize a página e tente de novo."],
    ["denied", "Não foi possível salvar. Confira o convênio e os profissionais escolhidos e tente de novo."],
  ] as const)("falha '%s' vira mensagem fixa em português, com os valores digitados, sem revalidar", async (reason, message) => {
    mocks.createPatient.mockResolvedValue({ ok: false, reason });
    const result = await savePatient(undefined, patientForm());
    expect(result).toMatchObject({ error: message, values: { fullName: "Maria Ficticia" } });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("a mensagem de erro nunca repete o texto do banco nem o CPF", async () => {
    mocks.createPatient.mockResolvedValue({ ok: false, reason: "duplicate-cpf" });
    const result = await savePatient(undefined, patientForm());
    expect(JSON.stringify({ error: (result as { error?: string }).error })).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
  });

  it("não deixa o cliente escolher o usuário: usa o da sessão, mesmo que o formulário traga outro", async () => {
    mocks.requireRole.mockResolvedValue(ADMIN);
    await savePatient(undefined, patientForm({ userId: RECEPTION.userId }));
    expect(mocks.createPatient.mock.calls[0]![0]).toEqual({ userId: ADMIN.userId });
  });
});

describe("setPatientActiveAction", () => {
  it("inativa e revalida (mesmo se o banco recusar, para mostrar o estado real)", async () => {
    await setPatientActiveAction(form({ id: ID, active: "false" }));
    expect(mocks.setPatientActive).toHaveBeenCalledWith({ userId: RECEPTION.userId }, ID, false);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pacientes");
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue(RECEPTION);
    mocks.setPatientActive.mockResolvedValue({ ok: false, reason: "not-found" });
    await setPatientActiveAction(form({ id: ID, active: "true" }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pacientes");
  });

  it("entrada inválida (id ou valor) não chama o banco", async () => {
    await setPatientActiveAction(form({ id: "abc", active: "false" }));
    await setPatientActiveAction(form({ id: ID, active: "talvez" }));
    expect(mocks.setPatientActive).not.toHaveBeenCalled();
  });
});

describe("searchPatients (a busca vai por POST: o termo, que pode ser um CPF, nunca fica na URL)", () => {
  const PROFESSIONAL = { userId: "44444444-4444-4444-8444-444444444444", role: "professional", fullName: "Prof Ficticio" };
  const item = { id: ID, fullName: "Maria", birthDate: "1990-05-10", phone: null, email: null, active: true };

  beforeEach(() => {
    mocks.requirePageAccess.mockResolvedValue(RECEPTION);
    mocks.listPatients.mockResolvedValue({ items: [item], truncated: false });
  });

  it("exige acesso à tela ANTES de qualquer coisa: sem acesso, não consulta", async () => {
    mocks.requirePageAccess.mockImplementation(async () => {
      throw new RedirectSignal("/dashboard?acesso=negado");
    });
    await expect(searchPatients(undefined, form({ q: "maria" }))).rejects.toBeInstanceOf(RedirectSignal);
    expect(mocks.requirePageAccess).toHaveBeenCalledWith("/pacientes");
    expect(mocks.listPatients).not.toHaveBeenCalled();
  });

  it("busca com o usuário da SESSÃO (o profissional também busca, mas só vê os dele por RLS) e devolve termo e lista", async () => {
    mocks.requirePageAccess.mockResolvedValue(PROFESSIONAL);
    const result = await searchPatients(undefined, form({ q: "maria", userId: RECEPTION.userId }));
    expect(mocks.listPatients).toHaveBeenCalledWith({ userId: PROFESSIONAL.userId }, { search: "maria" });
    expect(result).toEqual({ term: "maria", items: [item], truncated: false });
  });

  it("termo vazio ou ausente devolve a lista padrão; termo gigante é cortado em 100 caracteres", async () => {
    await searchPatients(undefined, form({}));
    expect(mocks.listPatients).toHaveBeenLastCalledWith({ userId: RECEPTION.userId }, { search: "" });
    await searchPatients(undefined, form({ q: "a".repeat(500) }));
    expect(mocks.listPatients.mock.calls.at(-1)![1].search).toHaveLength(100);
  });

  it("não grava nem revalida nada", async () => {
    await searchPatients(undefined, form({ q: "maria" }));
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("removePatientAction", () => {
  it("remove como admin, revalida e volta para a lista (a página do removido deixa de existir)", async () => {
    mocks.requireRole.mockResolvedValue(ADMIN);
    await removePatientAction(form({ id: ID }));
    expect(mocks.removePatient).toHaveBeenCalledWith({ userId: ADMIN.userId }, ID);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pacientes");
    expect(mocks.redirect).toHaveBeenCalledWith("/pacientes");
  });

  it("id inválido não chama o banco", async () => {
    mocks.requireRole.mockResolvedValue(ADMIN);
    await removePatientAction(form({ id: "abc" }));
    expect(mocks.removePatient).not.toHaveBeenCalled();
  });
});
