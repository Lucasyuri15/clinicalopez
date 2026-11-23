import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  createAppointment: vi.fn(),
  rescheduleAppointment: vi.fn(),
  cancelAppointment: vi.fn(),
  changeAppointmentStatus: vi.fn(),
  findCandidates: vi.fn(),
  revalidatePath: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("@/server/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/waitlist/candidates", () => ({ findCandidates: mocks.findCandidates }));
vi.mock("./mutations", () => ({
  createAppointment: mocks.createAppointment,
  rescheduleAppointment: mocks.rescheduleAppointment,
  cancelAppointment: mocks.cancelAppointment,
  changeAppointmentStatus: mocks.changeAppointmentStatus,
}));

import {
  cancelAppointmentAction,
  changeStatusAction,
  createAppointmentAction,
  rescheduleAppointmentAction,
} from "./actions";

const ADMIN = { userId: "11111111-1111-4111-8111-111111111111", role: "admin", fullName: "Admin Ficticio" };
const RECEPTION = { userId: "22222222-2222-4222-8222-222222222222", role: "reception", fullName: "Recepcao Ficticia" };
const PROFESSIONAL = { userId: "33333333-3333-4333-8333-333333333333", role: "professional", fullName: "Prof Ficticio" };
const OTHER_USER = "99999999-9999-4999-8999-999999999999";
const PATIENT = "6f1c1b5e-8a3f-4a0e-9d57-2f6c5f0b7a11";
const PROFESSIONAL_ID = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const SERVICE = "9c2d4e6f-1a3b-4c5d-8e7f-0a1b2c3d4e5f";
const ID = "44444444-4444-4444-8444-444444444444";
const FREED = {
  professionalId: PROFESSIONAL_ID,
  specialty: "physiotherapy",
  startsAt: new Date("2031-06-02T12:00:00.000Z"),
  endsAt: new Date("2031-06-02T12:50:00.000Z"),
};

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};
const createForm = (over: Record<string, string> = {}) =>
  form({
    patientId: PATIENT,
    professionalId: PROFESSIONAL_ID,
    serviceId: SERVICE,
    date: "2031-06-02",
    startTime: "09:00",
    durationMinutes: "50",
    ...over,
  });
const rescheduleForm = (over: Record<string, string> = {}) =>
  form({ id: ID, date: "2031-06-02", startTime: "15:00", durationMinutes: "50", ...over });

const allMutations = [mocks.createAppointment, mocks.rescheduleAppointment, mocks.cancelAppointment, mocks.changeAppointmentStatus];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue(RECEPTION);
  for (const fn of allMutations) fn.mockResolvedValue({ ok: true, id: ID });
  mocks.cancelAppointment.mockResolvedValue({ ok: true, id: ID, freed: FREED });
  mocks.findCandidates.mockResolvedValue([]);
});

const actions: Array<[string, () => Promise<unknown>, string[]]> = [
  ["createAppointmentAction", () => createAppointmentAction(undefined, createForm()), ["admin", "reception"]],
  ["rescheduleAppointmentAction", () => rescheduleAppointmentAction(undefined, rescheduleForm()), ["admin", "reception"]],
  ["cancelAppointmentAction", () => cancelAppointmentAction(undefined, form({ id: ID, reason: "Paciente desistiu" })), ["admin", "reception"]],
  ["changeStatusAction", () => changeStatusAction(undefined, form({ id: ID, status: "confirmed" })), ["admin", "reception", "professional"]],
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

  it("agendar, remarcar e cancelar nunca valem para o profissional; só mudar status vale", async () => {
    for (const [, run] of actions) await run();
    const calls = mocks.requireRole.mock.calls;
    for (const call of calls.slice(0, 3)) expect(call).toEqual(["admin", "reception"]);
    expect(calls[3]).toEqual(["admin", "reception", "professional"]);
    expect(calls.slice(0, 3).flat()).not.toContain("professional");
  });
});

describe("createAppointmentAction", () => {
  it("agenda com o usuário da SESSÃO (nunca do formulário), com instantes UTC e o horário certo", async () => {
    mocks.requireRole.mockResolvedValue(ADMIN);
    const data = createForm();
    data.append("userId", OTHER_USER);
    data.append("createdBy", OTHER_USER);
    expect(await createAppointmentAction(undefined, data)).toEqual({ success: true });
    expect(mocks.createAppointment).toHaveBeenCalledTimes(1);
    const [user, input] = mocks.createAppointment.mock.calls[0]!;
    expect(user).toEqual({ userId: ADMIN.userId });
    expect(input).toMatchObject({ patientId: PATIENT, professionalId: PROFESSIONAL_ID, serviceId: SERVICE });
    expect(input.startsAt.toISOString()).toBe("2031-06-02T12:00:00.000Z"); // 09:00 em Brasília
    expect(input.endsAt.toISOString()).toBe("2031-06-02T12:50:00.000Z");
    expect(input).not.toHaveProperty("createdBy");
    expect(input).not.toHaveProperty("status");
  });

  it("sucesso atualiza a agenda e a página do paciente (o vínculo pode ter sido criado)", async () => {
    await createAppointmentAction(undefined, createForm());
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agenda");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pacientes/[id]", "page");
  });

  it("valida a entrada: mensagem fixa, devolve o digitado e não grava", async () => {
    const result = await createAppointmentAction(undefined, createForm({ startTime: "09:03" }));
    expect(result).toMatchObject({
      error: "O horário deve ser de 5 em 5 minutos.",
      values: { startTime: "09:03", patientId: PATIENT, durationMinutes: "50" },
    });
    expect(mocks.createAppointment).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("recusa início no passado antes de ir ao banco", async () => {
    const result = await createAppointmentAction(undefined, createForm({ date: "2020-01-01" }));
    expect(result).toMatchObject({ error: "Esse horário já passou." });
    expect(mocks.createAppointment).not.toHaveBeenCalled();
  });

  it("campos ausentes viram erro de validação, não exceção", async () => {
    expect(await createAppointmentAction(undefined, new FormData())).toMatchObject({ error: expect.any(String) });
    expect(mocks.createAppointment).not.toHaveBeenCalled();
  });
});

describe("cada motivo de recusa vira uma mensagem fixa em pt-BR (sem dado do banco), com o digitado de volta", () => {
  const reasons: Array<[string, string]> = [
    ["not-found", "Paciente, profissional ou atendimento não encontrado. Atualize a página e tente de novo."],
    ["service-not-offered", "Este profissional não realiza o serviço escolhido."],
    ["past", "Esse horário já passou."],
    ["invalid-slot", "Horário inválido. Use horários de 5 em 5 minutos, dentro de um mesmo dia."],
    ["outside-grid", "Esse horário está fora do atendimento do profissional."],
    ["time-off", "O profissional tem uma folga ou bloqueio nesse horário."],
    ["conflict-professional", "O profissional já tem um atendimento nesse horário."],
    ["conflict-patient", "O paciente já tem um atendimento nesse horário."],
    ["changed", "Este atendimento foi alterado por outra pessoa. Atualize a página."],
    ["too-early", "Só é possível registrar Realizada ou Falta depois do início do atendimento."],
    ["not-allowed", "Você não tem permissão para essa mudança."],
    ["denied", "Não foi possível salvar. Confira os dados e tente de novo."],
    ["busy", "O sistema estava ocupado. Tente de novo."],
  ];

  it.each(reasons)("%s", async (reason, message) => {
    for (const fn of allMutations) fn.mockResolvedValue({ ok: false, reason });
    expect(await createAppointmentAction(undefined, createForm())).toMatchObject({ error: message, values: { startTime: "09:00" } });
    expect(await rescheduleAppointmentAction(undefined, rescheduleForm())).toMatchObject({ error: message });
    expect(await cancelAppointmentAction(undefined, form({ id: ID, reason: "Motivo" }))).toMatchObject({ error: message });
    expect(await changeStatusAction(undefined, form({ id: ID, status: "done" }))).toMatchObject({ error: message });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("rescheduleAppointmentAction", () => {
  it("remarca só o horário, com o usuário da sessão", async () => {
    mocks.requireRole.mockResolvedValue(ADMIN);
    expect(await rescheduleAppointmentAction(undefined, rescheduleForm())).toEqual({ success: true });
    const [user, input] = mocks.rescheduleAppointment.mock.calls[0]!;
    expect(user).toEqual({ userId: ADMIN.userId });
    expect(input.id).toBe(ID);
    expect(input.startsAt.toISOString()).toBe("2031-06-02T18:00:00.000Z"); // 15:00 em Brasília
    expect(input).not.toHaveProperty("professionalId");
    expect(input).not.toHaveProperty("serviceId");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agenda");
  });

  it("valida a entrada e não grava", async () => {
    expect(await rescheduleAppointmentAction(undefined, rescheduleForm({ id: "x" }))).toMatchObject({ error: "Atendimento inválido." });
    expect(await rescheduleAppointmentAction(undefined, rescheduleForm({ date: "2020-01-01" }))).toMatchObject({ error: "Esse horário já passou." });
    expect(mocks.rescheduleAppointment).not.toHaveBeenCalled();
  });
});

describe("cancelAppointmentAction", () => {
  it("cancela com o motivo limpo e o usuário da sessão", async () => {
    expect(await cancelAppointmentAction(undefined, form({ id: ID, reason: "  Paciente   avisou \n que viajou " }))).toEqual({ success: true });
    expect(mocks.cancelAppointment).toHaveBeenCalledWith({ userId: RECEPTION.userId }, { id: ID, reason: "Paciente avisou que viajou" });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agenda");
  });

  it("o motivo é obrigatório e não grava sem ele", async () => {
    expect(await cancelAppointmentAction(undefined, form({ id: ID, reason: "   " }))).toMatchObject({ error: "Informe o motivo do cancelamento." });
    expect(mocks.cancelAppointment).not.toHaveBeenCalled();
  });

  it("recusa do banco nunca repete o motivo digitado na mensagem de erro", async () => {
    mocks.cancelAppointment.mockResolvedValue({ ok: false, reason: "changed" });
    const result = await cancelAppointmentAction(undefined, form({ id: ID, reason: "texto sensível do paciente" }));
    expect((result as { error?: string }).error).not.toContain("sensível");
  });
});

describe("changeStatusAction", () => {
  it("passa o papel da sessão ao mapa de status (o profissional também muda o status dos próprios)", async () => {
    mocks.requireRole.mockResolvedValue(PROFESSIONAL);
    expect(await changeStatusAction(undefined, form({ id: ID, status: "done", role: "admin" }))).toEqual({ success: true });
    expect(mocks.changeAppointmentStatus).toHaveBeenCalledWith({ userId: PROFESSIONAL.userId }, { id: ID, status: "done" }, "professional");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agenda");
  });

  it("o papel vem da sessão, nunca de um campo do formulário", async () => {
    mocks.requireRole.mockResolvedValue(RECEPTION);
    await changeStatusAction(undefined, form({ id: ID, status: "confirmed", role: "admin" }));
    expect(mocks.changeAppointmentStatus.mock.calls[0]![2]).toBe("reception");
  });

  it.each(["cancelled", "scheduled", "", "feito"])("recusa o status %j (cancelar tem ação própria, com motivo)", async (status) => {
    expect(await changeStatusAction(undefined, form({ id: ID, status }))).toMatchObject({ error: "Status inválido." });
    expect(mocks.changeAppointmentStatus).not.toHaveBeenCalled();
  });
});

describe("cancelAppointmentAction: sugestão da lista de espera", () => {
  const cancel = () => cancelAppointmentAction(undefined, form({ id: ID, reason: "Paciente desistiu" }));
  const candidate = (over: Record<string, unknown> = {}) => ({
    entryId: "55555555-5555-4555-8555-555555555555",
    patientId: PATIENT,
    patientName: "Paciente Ficticio",
    serviceId: SERVICE,
    serviceName: "Sessão",
    startsAt: FREED.startsAt,
    endsAt: new Date("2031-06-02T12:50:00.000Z"),
    ...over,
  });

  it("sem ninguém na espera, o resultado é o de sempre (a gaveta fecha)", async () => {
    expect(await cancel()).toEqual({ success: true });
    expect(mocks.findCandidates).toHaveBeenCalledWith({ userId: RECEPTION.userId }, FREED);
  });

  it("com candidatos, devolve só o que a tela precisa, com datas em texto (nenhum id de paciente)", async () => {
    mocks.findCandidates.mockResolvedValue([candidate()]);
    const result = await cancel();
    expect(result).toEqual({
      success: true,
      suggestion: {
        professionalId: PROFESSIONAL_ID,
        startsAt: "2031-06-02T12:00:00.000Z",
        candidates: [
          {
            entryId: "55555555-5555-4555-8555-555555555555",
            patientName: "Paciente Ficticio",
            serviceName: "Sessão",
            endsAt: "2031-06-02T12:50:00.000Z",
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(PATIENT);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agenda");
  });

  it("a falha da busca NUNCA derruba o cancelamento: continua sucesso, sem sugestão", async () => {
    mocks.findCandidates.mockRejectedValue(new Error("falha de conexão"));
    expect(await cancel()).toEqual({ success: true });
    expect(mocks.cancelAppointment).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agenda");
  });

  it("cancelamento recusado não procura candidatos", async () => {
    mocks.cancelAppointment.mockResolvedValue({ ok: false, reason: "changed" });
    expect(await cancel()).toMatchObject({ error: expect.any(String) });
    expect(mocks.findCandidates).not.toHaveBeenCalled();
  });
});
