import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  saveNote: vi.fn(),
  finalizeNote: vi.fn(),
  addAddendum: vi.fn(),
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
  saveNote: mocks.saveNote,
  finalizeNote: mocks.finalizeNote,
  addAddendum: mocks.addAddendum,
}));

import { addAddendumAction, finalizeNoteAction, saveNoteAction } from "./actions";
import { CLINICAL_MESSAGES } from "./messages";

const PROFESSIONAL = { userId: "11111111-1111-4111-8111-111111111111", role: "professional", fullName: "Profissional Ficticio" };
const OTHER_USER = "99999999-9999-4999-8999-999999999999";
const APPOINTMENT = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const NOTE = "1c0a4c3d-6e8f-4a21-9b7c-4d3e2f1a0b99";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};
const saveForm = (over: Record<string, string> = {}) => form({ appointmentId: APPOINTMENT, body: "[teste] texto clínico", ...over });
const finalizeForm = (over: Record<string, string> = {}) => form({ noteId: NOTE, ...over });
const addendumForm = (over: Record<string, string> = {}) => form({ noteId: NOTE, body: "[teste] adendo", ...over });

const allMutations = [mocks.saveNote, mocks.finalizeNote, mocks.addAddendum];
const actions = [
  ["saveNoteAction", saveNoteAction, saveForm, mocks.saveNote],
  ["finalizeNoteAction", finalizeNoteAction, finalizeForm, mocks.finalizeNote],
  ["addAddendumAction", addAddendumAction, addendumForm, mocks.addAddendum],
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue(PROFESSIONAL);
  for (const mutation of allMutations) mutation.mockResolvedValue({ ok: true, noteId: NOTE });
});

describe("ações do prontuário", () => {
  it.each(actions)("%s só aceita o papel profissional (admin e recepção são barrados antes de ler a entrada)", async (_name, action, build) => {
    mocks.requireRole.mockRejectedValue(new RedirectSignal("/dashboard?acesso=negado"));
    await expect(action(undefined, build())).rejects.toBeInstanceOf(RedirectSignal);
    expect(mocks.requireRole).toHaveBeenCalledWith("professional");
    for (const mutation of allMutations) expect(mutation).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(actions)("%s usa o usuário da SESSÃO, nunca o do formulário", async (_name, action, build, mutation) => {
    expect(await action(undefined, build({ userId: OTHER_USER }))).toEqual({ success: true });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0]![0]).toEqual({ userId: PROFESSIONAL.userId });
  });

  it.each(actions)("%s revalida a ficha do paciente no sucesso", async (_name, action, build) => {
    await action(undefined, build());
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pacientes/[id]", "page");
  });

  it("salvar manda só o atendimento e o texto já limpo", async () => {
    await saveNoteAction(undefined, saveForm({ appointmentId: ` ${APPOINTMENT.toUpperCase()} `, body: "  Dor lombar.  " }));
    expect(mocks.saveNote).toHaveBeenCalledWith({ userId: PROFESSIONAL.userId }, { appointmentId: APPOINTMENT, body: "Dor lombar." });
  });

  it("finalizar manda só o id da evolução; adendar, o id e o texto", async () => {
    await finalizeNoteAction(undefined, finalizeForm());
    expect(mocks.finalizeNote).toHaveBeenCalledWith({ userId: PROFESSIONAL.userId }, { noteId: NOTE });
    await addAddendumAction(undefined, addendumForm({ body: " correção " }));
    expect(mocks.addAddendum).toHaveBeenCalledWith({ userId: PROFESSIONAL.userId }, { noteId: NOTE, body: "correção" });
  });

  it.each([
    ["not-found", CLINICAL_MESSAGES["not-found"]],
    ["not-realized", CLINICAL_MESSAGES["not-realized"]],
    ["locked", CLINICAL_MESSAGES.locked],
    ["not-finalized", CLINICAL_MESSAGES["not-finalized"]],
    ["denied", CLINICAL_MESSAGES.denied],
    ["busy", CLINICAL_MESSAGES.busy],
  ] as const)("recusa `%s` vira a mensagem fixa, devolve o texto digitado e não revalida", async (reason, message) => {
    mocks.saveNote.mockResolvedValue({ ok: false, reason });
    const state = await saveNoteAction(undefined, saveForm());
    expect(state).toEqual({ error: message, values: { appointmentId: APPOINTMENT, body: "[teste] texto clínico" } });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("entrada inválida: mensagem do Zod (que não repete o texto), valores devolvidos e a mutation não roda", async () => {
    const secret = "SEGREDO-CLINICO-123";
    const state = await saveNoteAction(undefined, saveForm({ appointmentId: "não-é-uuid", body: secret }));
    expect(state).toMatchObject({ error: "Atendimento inválido.", values: { body: secret } });
    expect((state as { error: string }).error).not.toContain(secret);
    expect(mocks.saveNote).not.toHaveBeenCalled();

    const empty = await saveNoteAction(undefined, saveForm({ body: "   " }));
    expect(empty).toMatchObject({ error: "Escreva a evolução." });
    const noAddendum = await addAddendumAction(undefined, addendumForm({ body: "" }));
    expect(noAddendum).toMatchObject({ error: "Escreva o adendo." });
    expect(mocks.addAddendum).not.toHaveBeenCalled();
  });
});
