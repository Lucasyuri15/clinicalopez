import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  previewSeries: vi.fn(),
  previewRenewal: vi.fn(),
  createSeries: vi.fn(),
  renewSeries: vi.fn(),
  cancelSeriesFrom: vi.fn(),
  rescheduleSeriesFrom: vi.fn(),
  revalidatePath: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("@/server/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./series-mutations", () => ({
  previewSeries: mocks.previewSeries,
  previewRenewal: mocks.previewRenewal,
  createSeries: mocks.createSeries,
  renewSeries: mocks.renewSeries,
  cancelSeriesFrom: mocks.cancelSeriesFrom,
  rescheduleSeriesFrom: mocks.rescheduleSeriesFrom,
}));

import {
  cancelSeriesFromAction,
  createSeriesAction,
  previewRenewalAction,
  previewSeriesAction,
  renewSeriesAction,
  rescheduleSeriesFromAction,
} from "./series-actions";

const ADMIN = { userId: "11111111-1111-4111-8111-111111111111", role: "admin", fullName: "Admin Ficticio" };
const RECEPTION = { userId: "22222222-2222-4222-8222-222222222222", role: "reception", fullName: "Recepcao Ficticia" };
const OTHER_USER = "99999999-9999-4999-8999-999999999999";
const PATIENT = "6f1c1b5e-8a3f-4a0e-9d57-2f6c5f0b7a11";
const PROFESSIONAL_ID = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const SERVICE = "9c2d4e6f-1a3b-4c5d-8e7f-0a1b2c3d4e5f";
const SERIES = "55555555-5555-4555-8555-555555555555";
const ID = "44444444-4444-4444-8444-444444444444";

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
};
// 2031-06-02 é segunda-feira (weekday 1).
const pattern = (over: Record<string, string | string[]> = {}) => ({
  date: "2031-06-02",
  startTime: "14:00",
  durationMinutes: "50",
  weekdays: ["1"],
  count: "4",
  ...over,
});
const seriesForm = (over: Record<string, string | string[]> = {}) =>
  form({ patientId: PATIENT, professionalId: PROFESSIONAL_ID, serviceId: SERVICE, ...pattern(), ...over });
const renewForm = (over: Record<string, string | string[]> = {}) => form({ seriesId: SERIES, ...pattern(), ...over });
const rescheduleForm = (over: Record<string, string> = {}) =>
  form({ id: ID, date: "2031-06-03", startTime: "15:00", durationMinutes: "40", ...over });

const allMutations = [
  mocks.previewSeries,
  mocks.previewRenewal,
  mocks.createSeries,
  mocks.renewSeries,
  mocks.cancelSeriesFrom,
  mocks.rescheduleSeriesFrom,
];

const placed = {
  ok: true,
  seriesId: SERIES,
  created: [{ id: ID, startsAt: new Date("2031-06-02T17:00:00Z") }],
  skipped: [{ startsAt: new Date("2031-06-09T17:00:00Z"), reason: "time-off" }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue(RECEPTION);
  mocks.previewSeries.mockResolvedValue({
    ok: true,
    items: [
      { startsAt: new Date("2031-06-02T17:00:00Z"), endsAt: new Date("2031-06-02T17:50:00Z"), verdict: { ok: true } },
      { startsAt: new Date("2031-06-09T17:00:00Z"), endsAt: new Date("2031-06-09T17:50:00Z"), verdict: { ok: false, reason: "time-off" } },
    ],
  });
  mocks.previewRenewal.mockResolvedValue({ ok: true, items: [] });
  mocks.createSeries.mockResolvedValue(placed);
  mocks.renewSeries.mockResolvedValue(placed);
  mocks.cancelSeriesFrom.mockResolvedValue({ ok: true, count: 3 });
  mocks.rescheduleSeriesFrom.mockResolvedValue({ ok: true, moved: [{ id: ID, startsAt: new Date("2031-06-03T18:00:00Z") }], skipped: [] });
});

const actions: Array<[string, () => Promise<unknown>]> = [
  ["previewSeriesAction", () => previewSeriesAction(undefined, seriesForm())],
  ["previewRenewalAction", () => previewRenewalAction(undefined, renewForm())],
  ["createSeriesAction", () => createSeriesAction(undefined, seriesForm())],
  ["renewSeriesAction", () => renewSeriesAction(undefined, renewForm())],
  ["cancelSeriesFromAction", () => cancelSeriesFromAction(undefined, form({ id: ID, reason: "Paciente desistiu" }))],
  ["rescheduleSeriesFromAction", () => rescheduleSeriesFromAction(undefined, rescheduleForm())],
];

describe("todas as ações de série exigem admin ou recepção ANTES de qualquer coisa", () => {
  it.each(actions)("%s: pede requireRole('admin','reception') e, se recusar, não lê, não grava nem revalida", async (_name, run) => {
    mocks.requireRole.mockImplementation(async () => {
      throw new RedirectSignal("/dashboard?acesso=negado");
    });
    await expect(run()).rejects.toBeInstanceOf(RedirectSignal);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin", "reception");
    for (const fn of allMutations) expect(fn).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("nenhuma vale para o profissional", async () => {
    for (const [, run] of actions) await run();
    expect(mocks.requireRole.mock.calls.flat()).not.toContain("professional");
  });
});

describe("previewSeriesAction", () => {
  it("só LÊ: usa o usuário da SESSÃO, manda as datas já calculadas e não revalida", async () => {
    mocks.requireRole.mockResolvedValue(ADMIN);
    const data = seriesForm();
    data.append("userId", OTHER_USER);
    const result = await previewSeriesAction(undefined, data);
    expect(mocks.previewSeries).toHaveBeenCalledTimes(1);
    const [user, input] = mocks.previewSeries.mock.calls[0]!;
    expect(user).toEqual({ userId: ADMIN.userId });
    expect(input).toMatchObject({ patientId: PATIENT, professionalId: PROFESSIONAL_ID, serviceId: SERVICE });
    expect(input.occurrences).toHaveLength(4);
    expect(input.occurrences[0].startsAt.toISOString()).toBe("2031-06-02T17:00:00.000Z"); // 14:00 em Brasília
    expect(input).not.toHaveProperty("userId");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      preview: [
        { startsAt: "2031-06-02T17:00:00.000Z", reason: null },
        { startsAt: "2031-06-09T17:00:00.000Z", reason: "time-off" },
      ],
      values: { patientId: PATIENT, startTime: "14:00", count: "4", weekdays: "1" },
    });
  });

  it("valida a entrada: mensagem fixa, devolve o digitado e não vai ao banco", async () => {
    const none = await previewSeriesAction(undefined, seriesForm({ weekdays: [] }));
    expect(none).toMatchObject({ error: "Escolha ao menos um dia da semana.", values: { count: "4" } });
    const tooMany = await previewSeriesAction(undefined, seriesForm({ count: "99" }));
    expect(tooMany).toMatchObject({ error: "Informe de 2 a 60 sessões." });
    expect(mocks.previewSeries).not.toHaveBeenCalled();
  });

  it("falha do banco vira mensagem fixa (nunca texto do banco)", async () => {
    mocks.previewSeries.mockResolvedValue({ ok: false, reason: "service-not-offered" });
    expect(await previewSeriesAction(undefined, seriesForm())).toMatchObject({ error: "Este profissional não realiza o serviço escolhido." });
  });
});

describe("previewRenewalAction", () => {
  it("lê a renovação da série informada", async () => {
    await previewRenewalAction(undefined, renewForm());
    const [user, input] = mocks.previewRenewal.mock.calls[0]!;
    expect(user).toEqual({ userId: RECEPTION.userId });
    expect(input.seriesId).toBe(SERIES);
    expect(input.occurrences).toHaveLength(4);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("série inválida não vai ao banco", async () => {
    expect(await previewRenewalAction(undefined, renewForm({ seriesId: "x" }))).toMatchObject({ error: "Série inválida." });
    expect(mocks.previewRenewal).not.toHaveBeenCalled();
  });
});

describe("createSeriesAction e renewSeriesAction", () => {
  it("criar: grava com o usuário da sessão, atualiza a agenda e a ficha do paciente e devolve o resumo", async () => {
    const result = await createSeriesAction(undefined, seriesForm());
    expect(mocks.createSeries).toHaveBeenCalledTimes(1);
    expect(mocks.createSeries.mock.calls[0]![0]).toEqual({ userId: RECEPTION.userId });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agenda");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pacientes/[id]", "page");
    expect(result).toEqual({ success: true, created: 1, skipped: [{ startsAt: "2031-06-09T17:00:00.000Z", reason: "time-off" }] });
  });

  it("nenhuma data cabe: mensagem fixa, sem revalidar", async () => {
    mocks.createSeries.mockResolvedValue({ ok: false, reason: "nothing-fits" });
    const result = await createSeriesAction(undefined, seriesForm());
    expect(result).toMatchObject({ error: expect.stringContaining("Nenhuma das datas da série cabe") });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("entrada inválida não grava", async () => {
    expect(await createSeriesAction(undefined, seriesForm({ patientId: "x" }))).toMatchObject({ error: "Paciente inválido." });
    expect(mocks.createSeries).not.toHaveBeenCalled();
  });

  it("renovar: usa a série informada e devolve o resumo", async () => {
    const result = await renewSeriesAction(undefined, renewForm());
    expect(mocks.renewSeries.mock.calls[0]![1].seriesId).toBe(SERIES);
    expect(result).toMatchObject({ success: true, created: 1 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agenda");
  });
});

describe("cancelSeriesFromAction", () => {
  it("cancela daqui para frente com o motivo limpo e devolve quantas foram", async () => {
    const result = await cancelSeriesFromAction(undefined, form({ id: ID, reason: "  Paciente   desistiu " }));
    expect(mocks.cancelSeriesFrom).toHaveBeenCalledWith({ userId: RECEPTION.userId }, { id: ID, reason: "Paciente desistiu" });
    expect(result).toEqual({ success: true, count: 3 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agenda");
  });

  it("motivo obrigatório; e o motivo digitado NUNCA aparece numa mensagem de erro", async () => {
    expect(await cancelSeriesFromAction(undefined, form({ id: ID, reason: "   " }))).toMatchObject({ error: "Informe o motivo do cancelamento." });
    expect(mocks.cancelSeriesFrom).not.toHaveBeenCalled();

    mocks.cancelSeriesFrom.mockResolvedValue({ ok: false, reason: "changed" });
    const failed = await cancelSeriesFromAction(undefined, form({ id: ID, reason: "Paciente SEGREDO-123" }));
    expect(JSON.stringify({ error: (failed as { error?: string }).error })).not.toContain("SEGREDO");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("rescheduleSeriesFromAction", () => {
  it("remarca daqui para frente com instantes UTC e devolve as que não foram movidas", async () => {
    mocks.rescheduleSeriesFrom.mockResolvedValue({
      ok: true,
      moved: [{ id: ID, startsAt: new Date("2031-06-03T18:00:00Z") }],
      skipped: [{ from: new Date("2031-06-23T17:00:00Z"), to: new Date("2031-06-24T18:00:00Z"), reason: "time-off" }],
    });
    const result = await rescheduleSeriesFromAction(undefined, rescheduleForm());
    const [user, input] = mocks.rescheduleSeriesFrom.mock.calls[0]!;
    expect(user).toEqual({ userId: RECEPTION.userId });
    expect(input.id).toBe(ID);
    expect(input.startsAt.toISOString()).toBe("2031-06-03T18:00:00.000Z"); // 15:00 em Brasília
    expect(input.endsAt.toISOString()).toBe("2031-06-03T18:40:00.000Z");
    expect(result).toEqual({
      success: true,
      moved: 1,
      unmoved: [{ from: "2031-06-23T17:00:00.000Z", to: "2031-06-24T18:00:00.000Z", reason: "time-off" }],
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/agenda");
  });

  it("recusa a própria sessão sem cabimento: mensagem fixa e sem revalidar", async () => {
    mocks.rescheduleSeriesFrom.mockResolvedValue({ ok: false, reason: "outside-grid" });
    expect(await rescheduleSeriesFromAction(undefined, rescheduleForm())).toMatchObject({ error: "Esse horário está fora do atendimento do profissional." });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("horário passado ou inválido não vai ao banco", async () => {
    expect(await rescheduleSeriesFromAction(undefined, rescheduleForm({ date: "2020-01-01" }))).toMatchObject({ error: "Esse horário já passou." });
    expect(mocks.rescheduleSeriesFrom).not.toHaveBeenCalled();
  });
});
