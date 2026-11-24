import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  uploadAttachmentAction: vi.fn(),
  removeAttachmentAction: vi.fn(),
}));
// As ações são "use server" (só rodam no servidor): aqui entram dublês com o mesmo contrato.
vi.mock("@/server/clinical/attachment-actions", () => ({
  uploadAttachmentAction: mocks.uploadAttachmentAction,
  removeAttachmentAction: mocks.removeAttachmentAction,
}));

import type { AttachmentView, PendingView } from "@/server/clinical/queries";

import { AttachmentsSection } from "./attachments-section";

const PATIENT = "77777777-7777-4777-8777-777777777777";
const ATT_PDF = "88888888-8888-4888-8888-888888888881";
const ATT_IMG = "88888888-8888-4888-8888-888888888882";
const ATT_GONE = "88888888-8888-4888-8888-888888888883";
const DONE = "99999999-9999-4999-8999-999999999991";

const attachments: AttachmentView[] = [
  { id: ATT_PDF, originalName: "Ressonância joelho.pdf", contentType: "application/pdf", sizeBytes: 1.5 * 1024 * 1024, createdAt: new Date("2031-10-13T18:00:00.000Z"), appointmentStartsAt: new Date("2031-10-06T17:00:00.000Z"), professionalName: "Ana Fisio", removedAt: null },
  { id: ATT_IMG, originalName: "Foto lesão.jpg", contentType: "image/jpeg", sizeBytes: 300 * 1024, createdAt: new Date("2031-10-14T18:00:00.000Z"), appointmentStartsAt: null, professionalName: "Ana Fisio", removedAt: null },
];
const removed: AttachmentView = { id: ATT_GONE, originalName: "Errado.pdf", contentType: "application/pdf", sizeBytes: 1024, createdAt: new Date("2031-10-12T18:00:00.000Z"), appointmentStartsAt: null, professionalName: "Ana Fisio", removedAt: new Date("2031-10-12T19:00:00.000Z") };
const doneAppointments: PendingView[] = [{ appointmentId: DONE, startsAt: new Date("2031-10-06T17:00:00.000Z"), serviceName: "Sessão" }];

beforeEach(() => {
  vi.resetAllMocks();
  // O componente rola o aviso de erro para a vista; o jsdom não implementa.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("cartão Anexos (profissional)", () => {
  const renderPro = (list = attachments) =>
    render(<AttachmentsSection role="professional" patientId={PATIENT} patientName="Maria Fictícia" attachments={list} doneAppointments={doneAppointments} />);

  it("lista os anexos dele com tipo, tamanho e o atendimento, e o link abre o anexo certo em outra aba", () => {
    renderPro();
    const list = screen.getByRole("list", { name: "Anexos de Maria Fictícia" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Ressonância joelho.pdf");
    expect(items[0]).toHaveTextContent("PDF · 1,5 MB");
    const link = screen.getByRole("link", { name: "Baixar Ressonância joelho.pdf" });
    expect(link).toHaveAttribute("href", `/pacientes/${PATIENT}/anexos/${ATT_PDF}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("link", { name: "Abrir Foto lesão.jpg" })).toBeInTheDocument();
  });

  it("sem anexos mostra a mensagem vazia", () => {
    renderPro([]);
    expect(screen.getByText("Nenhum anexo.")).toBeInTheDocument();
  });

  it("tem o botão Anexar arquivo e, por anexo, Remover (com o nome no rótulo acessível)", () => {
    renderPro();
    expect(screen.getByRole("button", { name: "Anexar arquivo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover Ressonância joelho.pdf" })).toBeInTheDocument();
  });

  it("remover pede confirmação clara e só então chama a ação", async () => {
    mocks.removeAttachmentAction.mockResolvedValue({ success: true });
    renderPro();
    fireEvent.click(screen.getByRole("button", { name: "Remover Ressonância joelho.pdf" }));
    expect(mocks.removeAttachmentAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Remover este anexo\?/)).toBeInTheDocument();
    expect(screen.getByText(/o registro e o arquivo ficam guardados/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await vi.waitFor(() => expect(mocks.removeAttachmentAction).toHaveBeenCalledTimes(1));
    const formData = mocks.removeAttachmentAction.mock.calls[0]![1] as FormData;
    expect(formData.get("attachmentId")).toBe(ATT_PDF);
  });

  it("a gaveta de anexar traz arquivo, atendimento opcional (só Realizados dele) e os ids escondidos", () => {
    renderPro();
    fireEvent.click(screen.getByRole("button", { name: "Anexar arquivo" }));
    const dialog = screen.getByRole("dialog");
    const file = within(dialog).getByLabelText("Arquivo") as HTMLInputElement;
    expect(file.type).toBe("file");
    expect(file.accept).toContain("application/pdf");
    expect(file.accept).not.toContain("svg");
    const select = within(dialog).getByLabelText("Atendimento (opcional)") as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(["Nenhum (anexo do paciente)", "06/10/2031 14:00 · Sessão"]);
    expect(dialog.querySelector<HTMLInputElement>("input[name=patientId]")?.value).toBe(PATIENT);
  });

  it("arquivo acima de 4 MB é recusado no navegador, com mensagem, sem enviar", async () => {
    renderPro();
    fireEvent.click(screen.getByRole("button", { name: "Anexar arquivo" }));
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText("Arquivo") as HTMLInputElement;
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "grande.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await within(dialog).findByText(/maior que 4 MB/)).toBeInTheDocument();
    expect(mocks.uploadAttachmentAction).not.toHaveBeenCalled();
  });

  it("erro do servidor aparece no formulário e o atendimento escolhido permanece", async () => {
    mocks.uploadAttachmentAction.mockResolvedValue({ error: "Este arquivo já foi anexado a este paciente.", values: { patientId: PATIENT, appointmentId: DONE } });
    renderPro();
    fireEvent.click(screen.getByRole("button", { name: "Anexar arquivo" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Arquivo"), { target: { files: [new File([new Uint8Array(10)], "a.pdf", { type: "application/pdf" })] } });
    fireEvent.change(within(dialog).getByLabelText("Atendimento (opcional)"), { target: { value: DONE } });
    // (o botão volta a "Anexar" quando a preparação do arquivo termina)
    fireEvent.click(await within(dialog).findByRole("button", { name: "Anexar" }));
    expect(await within(dialog).findByText("Este arquivo já foi anexado a este paciente.")).toBeInTheDocument();
    expect((within(dialog).getByLabelText("Atendimento (opcional)") as HTMLSelectElement).value).toBe(DONE);
  });
});

describe("cartão Anexos (admin)", () => {
  const renderAdmin = () =>
    render(<AttachmentsSection role="admin" patientId={PATIENT} patientName="Maria Fictícia" attachments={[...attachments, removed]} doneAppointments={[]} />);

  it("só leitura: sem Anexar nem Remover; mostra o autor e marca o removido", () => {
    renderAdmin();
    expect(screen.queryByRole("button", { name: /Anexar arquivo/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remover/ })).toBeNull();
    const items = within(screen.getByRole("list", { name: "Anexos de Maria Fictícia" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Ana Fisio");
    expect(items[2]).toHaveTextContent("Removido em 12/10/2031");
    expect(screen.getByText(/Somente leitura/)).toBeInTheDocument();
  });

  it("o admin ainda abre o anexo removido", () => {
    renderAdmin();
    expect(screen.getByRole("link", { name: "Baixar Errado.pdf" })).toHaveAttribute("href", `/pacientes/${PATIENT}/anexos/${ATT_GONE}`);
  });
});
