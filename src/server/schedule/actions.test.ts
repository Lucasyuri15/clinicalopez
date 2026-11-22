import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  revalidatePath: vi.fn(),
  saveWeek: vi.fn(),
  addTimeOff: vi.fn(),
  removeTimeOff: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("@/server/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./mutations", () => ({
  saveWeek: mocks.saveWeek,
  addTimeOff: mocks.addTimeOff,
  removeTimeOff: mocks.removeTimeOff,
}));

import { addTimeOffAction, removeTimeOffAction, saveWeekAction } from "./actions";

const ADMIN = { userId: "11111111-1111-4111-8111-111111111111", role: "admin", fullName: "Admin Ficticio" };
const PRO = "6f1c1b5e-8a3f-4a0e-9d57-2f6c5f0b7a11";
const OFF = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const H = (hours: number, minutes = 0) => hours * 60 + minutes;

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const weekForm = (ranges: unknown, over: Record<string, string> = {}) =>
  form({ professionalId: PRO, ranges: JSON.stringify(ranges), ...over });
const offForm = (over: Record<string, string> = {}) =>
  form({
    professionalId: PRO,
    startDate: "2026-12-24",
    endDate: "2026-12-26",
    allDay: "on",
    startTime: "",
    endTime: "",
    reason: "",
    ...over,
  });

const allMutations = [mocks.saveWeek, mocks.addTimeOff, mocks.removeTimeOff];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue(ADMIN);
  for (const fn of allMutations) fn.mockResolvedValue({ ok: true, id: PRO });
});

const actions: Array<[string, () => Promise<unknown>]> = [
  ["saveWeekAction", () => saveWeekAction(undefined, weekForm([]))],
  ["addTimeOffAction", () => addTimeOffAction(undefined, offForm())],
  ["removeTimeOffAction", () => removeTimeOffAction(form({ id: OFF }))],
];

describe("todas as ações exigem administrador ou recepção ANTES de qualquer coisa", () => {
  it.each(actions)("%s: pede requireRole('admin', 'reception') e, se recusar, não grava nem revalida", async (_name, run) => {
    mocks.requireRole.mockImplementation(async () => {
      throw new RedirectSignal("/dashboard?acesso=negado");
    });
    await expect(run()).rejects.toBeInstanceOf(RedirectSignal);
    // O profissional NÃO está na lista: ele só lê a própria grade.
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "reception");
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(actions)("%s: com admin, chama requireRole('admin', 'reception') e grava", async (_name, run) => {
    await run();
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "reception");
    expect(allMutations.some((fn) => fn.mock.calls.length > 0)).toBe(true);
  });

  it.each(actions)("%s: com a recepção, grava com o usuário da SESSÃO (nunca do formulário)", async (_name, run) => {
    const reception = { userId: "22222222-2222-4222-8222-222222222222", role: "reception", fullName: "Recepcao Ficticia" };
    mocks.requireRole.mockResolvedValue(reception);
    await run();
    const call = allMutations.map((fn) => fn.mock.calls[0]).find(Boolean);
    expect(call?.[0]).toEqual({ userId: reception.userId });
  });
});

describe("saveWeekAction", () => {
  it("valida o JSON da semana, grava em minutos e atualiza a tela do profissional", async () => {
    const result = await saveWeekAction(
      undefined,
      weekForm([
        { weekday: 1, start: "14:00", end: "18:00" },
        { weekday: 1, start: "08:00", end: "12:00" },
      ]),
    );
    expect(result).toEqual({ success: true });
    expect(mocks.saveWeek).toHaveBeenCalledWith(
      { userId: ADMIN.userId },
      {
        professionalId: PRO,
        ranges: [
          { weekday: 1, start: H(8), end: H(12) },
          { weekday: 1, start: H(14), end: H(18) },
        ],
      },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profissionais/[id]/horarios", "page");
  });

  it("semana vazia é válida (limpa a grade)", async () => {
    expect(await saveWeekAction(undefined, weekForm([]))).toEqual({ success: true });
    expect(mocks.saveWeek).toHaveBeenCalledWith({ userId: ADMIN.userId }, { professionalId: PRO, ranges: [] });
  });

  it.each([
    ["sobreposição", weekForm([{ weekday: 1, start: "08:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "13:00" }]), "Segunda-feira: as faixas 08:00–12:00 e 11:00–13:00 se sobrepõem."],
    ["horário em formato errado", weekForm([{ weekday: 1, start: "8h", end: "12:00" }]), "Use horários no formato 08:00."],
    ["JSON quebrado", form({ professionalId: PRO, ranges: "[{" }), "Dados da semana inválidos."],
    ["profissional inválido", weekForm([], { professionalId: "x" }), "Registro inválido."],
  ])("entrada inválida (%s): mensagem em pt-BR, devolve o que foi enviado e NÃO grava", async (_label, data, message) => {
    const result = await saveWeekAction(undefined, data);
    expect(result?.error).toBe(message);
    expect(result?.values).toMatchObject({ ranges: expect.any(String) });
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("formulário vazio não estoura", async () => {
    expect((await saveWeekAction(undefined, new FormData()))?.error).toBeTruthy();
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
  });

  it.each([
    ["overlap", "Não foi possível salvar: há faixas que se sobrepõem. Confira os horários e tente de novo."],
    ["not-found", "Profissional não encontrado. Atualize a página e tente de novo."],
    ["denied", "Não foi possível salvar. Atualize a página e tente de novo."],
  ] as const)("falha '%s' do banco vira mensagem fixa, sem texto técnico, e não revalida", async (reason, message) => {
    mocks.saveWeek.mockResolvedValue({ ok: false, reason });
    const result = await saveWeekAction(undefined, weekForm([{ weekday: 1, start: "08:00", end: "12:00" }]));
    expect(result?.error).toBe(message);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("addTimeOffAction", () => {
  it("dia inteiro: converte as datas de Brasília para UTC, grava e atualiza a tela", async () => {
    expect(await addTimeOffAction(undefined, offForm({ reason: "  Férias de   fim de ano " }))).toEqual({ success: true });
    const [, input] = mocks.addTimeOff.mock.calls[0] ?? [];
    expect(input.professionalId).toBe(PRO);
    expect(input.startsAt.toISOString()).toBe("2026-12-24T03:00:00.000Z");
    expect(input.endsAt.toISOString()).toBe("2026-12-27T03:00:00.000Z");
    expect(input.reason).toBe("Férias de fim de ano");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profissionais/[id]/horarios", "page");
  });

  it("bloqueio parcial usa os horários informados", async () => {
    await addTimeOffAction(undefined, offForm({ allDay: "", endDate: "2026-12-24", startTime: "14:00", endTime: "18:00" }));
    const [, input] = mocks.addTimeOff.mock.calls[0] ?? [];
    expect(input.startsAt.toISOString()).toBe("2026-12-24T17:00:00.000Z");
    expect(input.endsAt.toISOString()).toBe("2026-12-24T21:00:00.000Z");
  });

  it.each([
    ["data de término antes da de início", offForm({ startDate: "2026-12-26", endDate: "2026-12-24" }), "A data de término não pode ser antes da de início."],
    ["ano absurdo", offForm({ endDate: "9999-12-31" }), "Informe uma data entre 2000 e 2100."],
    ["parcial sem horários", offForm({ allDay: "" }), "Informe os horários de início e de fim, de 5 em 5 minutos."],
    ["motivo com byte nulo", offForm({ reason: "Fér\u0000ias" }), "O motivo contém caracteres inválidos."],
    ["período de mais de 366 dias", offForm({ startDate: "2026-01-01", endDate: "2027-12-31" }), "O período pode ter no máximo 366 dias."],
  ])("entrada inválida (%s): mensagem em pt-BR, devolve o que foi digitado e NÃO grava", async (_label, data, message) => {
    const result = await addTimeOffAction(undefined, data);
    expect(result?.error).toBe(message);
    expect(result?.values).toMatchObject({ startDate: expect.any(String), endDate: expect.any(String), reason: expect.any(String) });
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("falha do banco vira mensagem fixa e devolve o que foi digitado", async () => {
    mocks.addTimeOff.mockResolvedValue({ ok: false, reason: "denied" });
    const result = await addTimeOffAction(undefined, offForm({ reason: "Férias" }));
    expect(result).toEqual({
      error: "Não foi possível salvar. Atualize a página e tente de novo.",
      values: { startDate: "2026-12-24", endDate: "2026-12-26", allDay: "on", startTime: "", endTime: "", reason: "Férias" },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("removeTimeOffAction", () => {
  it("valida o id, remove e atualiza a tela", async () => {
    await removeTimeOffAction(form({ id: OFF }));
    expect(mocks.removeTimeOff).toHaveBeenCalledWith({ userId: ADMIN.userId }, OFF);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profissionais/[id]/horarios", "page");
  });

  it.each([[{ id: "x" }], [{}]])("id inválido %j: não remove", async (fields) => {
    await removeTimeOffAction(form(fields));
    expect(mocks.removeTimeOff).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("se o banco recusa (já removida por outro admin), a tela é atualizada do mesmo jeito", async () => {
    mocks.removeTimeOff.mockResolvedValue({ ok: false, reason: "not-found" });
    await removeTimeOffAction(form({ id: OFF }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/profissionais/[id]/horarios", "page");
  });
});
