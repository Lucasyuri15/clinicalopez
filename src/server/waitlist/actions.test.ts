import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  addEntry: vi.fn(),
  updateEntry: vi.fn(),
  removeEntry: vi.fn(),
  revalidatePath: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("@/server/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./mutations", () => ({
  addEntry: mocks.addEntry,
  updateEntry: mocks.updateEntry,
  removeEntry: mocks.removeEntry,
}));

import { addWaitlistAction, removeWaitlistAction, updateWaitlistAction } from "./actions";
import { WAITLIST_MESSAGES } from "./messages";

const ADMIN = { userId: "11111111-1111-4111-8111-111111111111", role: "admin", fullName: "Admin Ficticio" };
const RECEPTION = { userId: "22222222-2222-4222-8222-222222222222", role: "reception", fullName: "Recepcao Ficticia" };
const OTHER_USER = "99999999-9999-4999-8999-999999999999";
const PATIENT = "6f1c1b5e-8a3f-4a0e-9d57-2f6c5f0b7a11";
const PROFESSIONAL_ID = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const SERVICE = "9c2d4e6f-1a3b-4c5d-8e7f-0a1b2c3d4e5f";
const ID = "44444444-4444-4444-8444-444444444444";

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
};
const preference = (over: Record<string, string | string[]> = {}) => ({
  professionalId: "",
  weekdays: [] as string[],
  startTime: "",
  endTime: "",
  note: "",
  ...over,
});
const addForm = (over: Record<string, string | string[]> = {}) =>
  form({ patientId: PATIENT, serviceId: SERVICE, ...preference(), ...over });
const updateForm = (over: Record<string, string | string[]> = {}) => form({ id: ID, ...preference(), ...over });

const allMutations = [mocks.addEntry, mocks.updateEntry, mocks.removeEntry];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue(RECEPTION);
  mocks.addEntry.mockResolvedValue({ ok: true, id: ID });
  mocks.updateEntry.mockResolvedValue({ ok: true, id: ID });
  mocks.removeEntry.mockResolvedValue({ ok: true, id: ID });
});

const actions: Array<[string, () => Promise<unknown>]> = [
  ["addWaitlistAction", () => addWaitlistAction(undefined, addForm())],
  ["updateWaitlistAction", () => updateWaitlistAction(undefined, updateForm())],
  ["removeWaitlistAction", () => removeWaitlistAction(undefined, form({ id: ID }))],
];

describe("todas as ações da lista de espera exigem admin ou recepção ANTES de qualquer coisa", () => {
  it.each(actions)("%s: pede requireRole('admin','reception') e, se recusar, não grava nem revalida", async (_name, run) => {
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

describe("addWaitlistAction", () => {
  it("usa o usuário da SESSÃO (nunca o do formulário) e manda a preferência já validada", async () => {
    mocks.requireRole.mockResolvedValue(ADMIN);
    const data = addForm({ professionalId: PROFESSIONAL_ID, weekdays: ["3", "1"], startTime: "14:00", endTime: "18:00", note: "  prefere   tarde " });
    data.append("userId", OTHER_USER);
    const result = await addWaitlistAction(undefined, data);
    expect(result).toEqual({ success: true });
    expect(mocks.addEntry).toHaveBeenCalledTimes(1);
    const [user, input] = mocks.addEntry.mock.calls[0]!;
    expect(user).toEqual({ userId: ADMIN.userId });
    expect(input).toEqual({
      patientId: PATIENT,
      serviceId: SERVICE,
      professionalId: PROFESSIONAL_ID,
      weekdays: [1, 3],
      startMinute: 840,
      endMinute: 1080,
      note: "prefere tarde",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/lista-espera");
  });

  it("entrada inválida não chega ao banco; devolve a mensagem e os valores digitados", async () => {
    const result = await addWaitlistAction(undefined, addForm({ patientId: "x", weekdays: ["8"], startTime: "10:00" }));
    expect(result).toMatchObject({ error: expect.any(String), values: { patientId: "x", weekdays: "8", startTime: "10:00" } });
    expect(mocks.addEntry).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(Object.entries(WAITLIST_MESSAGES).filter(([key]) => key !== "generic"))(
    "recusa '%s' vira a mensagem fixa e devolve os valores",
    async (reason, message) => {
      mocks.addEntry.mockResolvedValue({ ok: false, reason });
      const result = await addWaitlistAction(undefined, addForm({ note: "SEGREDO-DE-SAUDE" }));
      expect(result).toMatchObject({ error: message, values: { note: "SEGREDO-DE-SAUDE" } });
      expect(JSON.stringify(result?.error)).not.toContain("SEGREDO");
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("updateWaitlistAction", () => {
  it("edita só a preferência da espera pedida, com o usuário da sessão", async () => {
    const result = await updateWaitlistAction(undefined, updateForm({ weekdays: ["5"], startTime: "08:00", endTime: "12:00" }));
    expect(result).toEqual({ success: true });
    const [user, input] = mocks.updateEntry.mock.calls[0]!;
    expect(user).toEqual({ userId: RECEPTION.userId });
    expect(input).toEqual({ id: ID, professionalId: null, weekdays: [5], startMinute: 480, endMinute: 720, note: null });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/lista-espera");
  });

  it("entrada inválida e recusa do banco devolvem mensagem, sem revalidar", async () => {
    expect(await updateWaitlistAction(undefined, updateForm({ id: "nope" }))).toMatchObject({ error: expect.any(String) });
    mocks.updateEntry.mockResolvedValue({ ok: false, reason: "changed" });
    expect(await updateWaitlistAction(undefined, updateForm())).toMatchObject({ error: WAITLIST_MESSAGES.changed });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("removeWaitlistAction", () => {
  it("tira da espera e revalida", async () => {
    expect(await removeWaitlistAction(undefined, form({ id: ID }))).toEqual({ success: true });
    expect(mocks.removeEntry).toHaveBeenCalledWith({ userId: RECEPTION.userId }, { id: ID });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/lista-espera");
  });

  it("id inválido não chega ao banco; recusa vira mensagem fixa", async () => {
    expect(await removeWaitlistAction(undefined, form({ id: "x" }))).toMatchObject({ error: expect.any(String) });
    expect(mocks.removeEntry).not.toHaveBeenCalled();
    mocks.removeEntry.mockResolvedValue({ ok: false, reason: "not-found" });
    expect(await removeWaitlistAction(undefined, form({ id: ID }))).toMatchObject({ error: WAITLIST_MESSAGES["not-found"] });
  });
});
