// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  uploadAttachment: vi.fn(),
  removeAttachment: vi.fn(),
  getAttachmentStore: vi.fn(),
  revalidatePath: vi.fn(),
}));

class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

vi.mock("@/server/auth/session", () => ({ requireRole: mocks.requireRole }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/storage", () => ({ getAttachmentStore: mocks.getAttachmentStore }));
vi.mock("./attachments", () => ({ uploadAttachment: mocks.uploadAttachment, removeAttachment: mocks.removeAttachment }));

import { removeAttachmentAction, uploadAttachmentAction } from "./attachment-actions";
import { ATTACHMENT_MESSAGES } from "./messages";

const PROFESSIONAL = { userId: "11111111-1111-4111-8111-111111111111", role: "professional", fullName: "Profissional Ficticio" };
const PATIENT = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const APPOINTMENT = "1c0a4c3d-6e8f-4a21-9b7c-4d3e2f1a0b99";
const ATTACHMENT = "2d1b5d4e-7f90-4b32-8c8d-5e4f3a2b1c00";
const STORE = { name: "store" };

const pdfFile = (name = "laudo.pdf", size = 20) => new File([new Uint8Array(size).fill(1)], name, { type: "application/pdf" });
const uploadForm = (over: { file?: File | null; patientId?: string; appointmentId?: string } = {}) => {
  const data = new FormData();
  data.append("patientId", over.patientId ?? PATIENT);
  data.append("appointmentId", over.appointmentId ?? "");
  if (over.file !== null) data.append("file", over.file ?? pdfFile());
  return data;
};
const removeForm = (attachmentId = ATTACHMENT) => {
  const data = new FormData();
  data.append("attachmentId", attachmentId);
  return data;
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireRole.mockResolvedValue(PROFESSIONAL);
  mocks.getAttachmentStore.mockResolvedValue(STORE);
  mocks.uploadAttachment.mockResolvedValue({ ok: true, attachmentId: ATTACHMENT });
  mocks.removeAttachment.mockResolvedValue({ ok: true, attachmentId: ATTACHMENT });
});

describe("ações dos anexos clínicos", () => {
  it.each([
    ["uploadAttachmentAction", () => uploadAttachmentAction(undefined, uploadForm())],
    ["removeAttachmentAction", () => removeAttachmentAction(undefined, removeForm())],
  ] as const)("%s só aceita o papel profissional (admin e recepção são barrados antes de ler a entrada)", async (_name, run) => {
    mocks.requireRole.mockRejectedValue(new RedirectSignal("/dashboard?acesso=negado"));
    await expect(run()).rejects.toBeInstanceOf(RedirectSignal);
    expect(mocks.requireRole).toHaveBeenCalledWith("professional");
    expect(mocks.uploadAttachment).not.toHaveBeenCalled();
    expect(mocks.removeAttachment).not.toHaveBeenCalled();
    expect(mocks.getAttachmentStore).not.toHaveBeenCalled();
  });

  it("enviar: usa o usuário da SESSÃO, os bytes do arquivo, o nome e o atendimento, e atualiza a ficha", async () => {
    const result = await uploadAttachmentAction(undefined, uploadForm({ appointmentId: APPOINTMENT, file: pdfFile("Exame joelho.pdf", 7) }));
    expect(result).toEqual({ success: true });
    const [user, input, store] = mocks.uploadAttachment.mock.calls[0]!;
    expect(user).toEqual({ userId: PROFESSIONAL.userId });
    expect(input).toMatchObject({ patientId: PATIENT, appointmentId: APPOINTMENT, name: "Exame joelho.pdf" });
    expect(input.bytes).toHaveLength(7);
    expect(store).toBe(STORE);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pacientes/[id]", "page");
  });

  it("enviar: o atendimento é opcional (vazio vira null)", async () => {
    await uploadAttachmentAction(undefined, uploadForm());
    expect(mocks.uploadAttachment.mock.calls[0]![1].appointmentId).toBeNull();
  });

  it("enviar: nenhum arquivo escolhido pede um arquivo, sem chamar a camada de dados", async () => {
    const empty = new File([], "", { type: "application/octet-stream" });
    for (const file of [null, empty]) {
      expect(await uploadAttachmentAction(undefined, uploadForm({ file }))).toMatchObject({ error: ATTACHMENT_MESSAGES["no-file"] });
    }
    expect(mocks.uploadAttachment).not.toHaveBeenCalled();
  });

  it("enviar: arquivo vazio com nome é `empty`; acima de 4 MiB é recusado SEM ler o arquivo", async () => {
    expect(await uploadAttachmentAction(undefined, uploadForm({ file: new File([], "vazio.pdf") }))).toMatchObject({ error: ATTACHMENT_MESSAGES.empty });
    const big = pdfFile("grande.pdf", 4 * 1024 * 1024 + 1);
    const read = vi.spyOn(big, "arrayBuffer");
    expect(await uploadAttachmentAction(undefined, uploadForm({ file: big }))).toMatchObject({ error: ATTACHMENT_MESSAGES["too-large"] });
    expect(read).not.toHaveBeenCalled();
    expect(mocks.uploadAttachment).not.toHaveBeenCalled();
  });

  it("enviar: ids inválidos viram mensagem fixa e o arquivo nunca volta no estado do formulário", async () => {
    const result = await uploadAttachmentAction(undefined, uploadForm({ patientId: "x" }));
    expect(result).toMatchObject({ error: "Paciente inválido." });
    expect(result?.values).toEqual({ patientId: "x", appointmentId: "" });
    expect(mocks.uploadAttachment).not.toHaveBeenCalled();
  });

  it.each(Object.keys(ATTACHMENT_MESSAGES).filter((key) => key !== "generic" && key !== "no-file"))(
    "enviar: o motivo `%s` vira a mensagem fixa em pt-BR, sem texto do banco",
    async (reason) => {
      mocks.uploadAttachment.mockResolvedValue({ ok: false, reason });
      const result = await uploadAttachmentAction(undefined, uploadForm());
      expect(result).toMatchObject({ error: ATTACHMENT_MESSAGES[reason as keyof typeof ATTACHMENT_MESSAGES] });
      expect(mocks.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("remover: valida o id, usa o usuário da sessão e atualiza a ficha", async () => {
    expect(await removeAttachmentAction(undefined, removeForm("não-é-uuid"))).toMatchObject({ error: "Anexo inválido." });
    expect(mocks.removeAttachment).not.toHaveBeenCalled();
    expect(await removeAttachmentAction(undefined, removeForm())).toEqual({ success: true });
    expect(mocks.removeAttachment).toHaveBeenCalledWith({ userId: PROFESSIONAL.userId }, { attachmentId: ATTACHMENT });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/pacientes/[id]", "page");
  });

  it("remover: motivo de recusa vira mensagem fixa", async () => {
    mocks.removeAttachment.mockResolvedValue({ ok: false, reason: "not-found" });
    expect(await removeAttachmentAction(undefined, removeForm())).toMatchObject({ error: ATTACHMENT_MESSAGES["not-found"] });
  });
});
