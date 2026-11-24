import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveNoteAction: vi.fn(),
  finalizeNoteAction: vi.fn(),
  addAddendumAction: vi.fn(),
}));
// As ações são "use server" (só rodam no servidor): aqui entram dublês com o mesmo contrato.
vi.mock("@/server/clinical/actions", () => ({
  saveNoteAction: mocks.saveNoteAction,
  finalizeNoteAction: mocks.finalizeNoteAction,
  addAddendumAction: mocks.addAddendumAction,
}));

import type { NoteView, PendingView } from "@/server/clinical/queries";

import { RecordSection } from "./record-section";

const NOTE_DRAFT = "55555555-5555-4555-8555-555555555551";
const NOTE_FINAL = "55555555-5555-4555-8555-555555555552";
const APPOINTMENT_PENDING = "66666666-6666-4666-8666-666666666661";

const pending: PendingView[] = [{ appointmentId: APPOINTMENT_PENDING, startsAt: new Date("2031-10-06T17:00:00.000Z"), serviceName: "Sessão" }];
const notes: NoteView[] = [
  {
    id: NOTE_DRAFT,
    appointmentId: "66666666-6666-4666-8666-666666666662",
    startsAt: new Date("2031-10-13T17:00:00.000Z"),
    serviceName: "Sessão",
    professionalName: "Ana Fisio",
    status: "draft",
    body: "Texto do rascunho",
    createdAt: new Date("2031-10-13T18:00:00.000Z"),
    finalizedAt: null,
    addenda: [],
  },
  {
    id: NOTE_FINAL,
    appointmentId: "66666666-6666-4666-8666-666666666663",
    startsAt: new Date("2031-10-02T17:00:00.000Z"),
    serviceName: "Avaliação",
    professionalName: "Ana Fisio",
    status: "finalized",
    body: "Texto finalizado",
    createdAt: new Date("2031-10-02T18:00:00.000Z"),
    finalizedAt: new Date("2031-10-02T19:00:00.000Z"),
    addenda: [{ id: "77777777-7777-4777-8777-777777777771", body: "Texto do adendo", createdAt: new Date("2031-10-03T12:00:00.000Z"), authorName: "Ana Fisio" }],
  },
];

// Sem `globals`, o Testing Library não limpa sozinho entre os testes.
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  // O jsdom não implementa `scrollIntoView`, que o formulário chama ao mostrar um erro.
  Element.prototype.scrollIntoView = vi.fn();
  for (const action of Object.values(mocks)) action.mockResolvedValue({ success: true });
});

const professionalView = () => render(<RecordSection role="professional" patientName="Paciente Teste" notes={notes} pending={pending} />);

describe("RecordSection: profissional", () => {
  it("oferece 'Escrever evolução' para cada atendimento Realizado sem evolução, com data e serviço no rótulo", () => {
    professionalView();
    expect(screen.getByRole("button", { name: "Escrever evolução de 06/10/2031 14:00 · Sessão" })).toBeInTheDocument();
  });

  it("rascunho: mostra 'Continuar' e 'Finalizar' e marca como rascunho; finalizada: mostra adendo e esconde edição", () => {
    professionalView();
    const items = screen.getAllByRole("listitem");
    const draft = items.find((item) => within(item).queryByText("Texto do rascunho"))!;
    expect(within(draft).getByText("Rascunho")).toBeInTheDocument();
    expect(within(draft).getByRole("button", { name: /Continuar a evolução de 13\/10\/2031 14:00/ })).toBeInTheDocument();
    expect(within(draft).getByRole("button", { name: /Finalizar a evolução de 13\/10\/2031 14:00/ })).toBeInTheDocument();
    expect(within(draft).queryByRole("button", { name: /Adicionar adendo/ })).toBeNull();

    const final = items.find((item) => within(item).queryByText("Texto finalizado"))!;
    expect(within(final).getByText(/Finalizada em 02\/10\/2031/)).toBeInTheDocument();
    expect(within(final).getByText("Texto do adendo")).toBeInTheDocument();
    expect(within(final).getByRole("button", { name: /Adicionar adendo à evolução de 02\/10\/2031 14:00/ })).toBeInTheDocument();
    expect(within(final).queryByRole("button", { name: /Continuar|Finalizar/ })).toBeNull();
  });

  it("Finalizar pede confirmação deixando claro que não dá para editar depois; confirmar manda só a evolução", async () => {
    professionalView();
    fireEvent.click(screen.getByRole("button", { name: /Finalizar a evolução de 13\/10\/2031 14:00/ }));
    expect(screen.getByText(/não dá para editar/i)).toBeInTheDocument();
    expect(mocks.finalizeNoteAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(mocks.finalizeNoteAction).toHaveBeenCalledTimes(1));
    const formData = mocks.finalizeNoteAction.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(formData.entries())).toEqual({ noteId: NOTE_DRAFT });
  });

  it("Cancelar na confirmação não finaliza nada", () => {
    professionalView();
    fireEvent.click(screen.getByRole("button", { name: /Finalizar a evolução/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(mocks.finalizeNoteAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Finalizar a evolução/ })).toBeInTheDocument();
  });

  it("a gaveta de escrever manda só o atendimento e o texto; no sucesso fecha", async () => {
    professionalView();
    fireEvent.click(screen.getByRole("button", { name: /Escrever evolução de 06\/10\/2031/ }));
    const textarea = await screen.findByLabelText("Evolução");
    fireEvent.change(textarea, { target: { value: "Paciente evoluiu bem." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    await waitFor(() => expect(mocks.saveNoteAction).toHaveBeenCalledTimes(1));
    const formData = mocks.saveNoteAction.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(formData.entries())).toEqual({ appointmentId: APPOINTMENT_PENDING, body: "Paciente evoluiu bem." });
    await waitFor(() => expect(screen.queryByLabelText("Evolução")).toBeNull());
  });

  it("uma recusa aparece em texto, a gaveta continua aberta e o texto digitado NÃO se perde", async () => {
    mocks.saveNoteAction.mockResolvedValue({
      error: "Esta evolução já foi finalizada e não pode mais ser editada. Use um adendo.",
      values: { appointmentId: APPOINTMENT_PENDING, body: "Texto que não pode sumir" },
    });
    professionalView();
    fireEvent.click(screen.getByRole("button", { name: /Escrever evolução de 06\/10\/2031/ }));
    fireEvent.change(await screen.findByLabelText("Evolução"), { target: { value: "Texto que não pode sumir" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("já foi finalizada");
    expect(screen.getByLabelText("Evolução")).toHaveValue("Texto que não pode sumir");
  });

  it("a gaveta de adendo manda a evolução e o texto", async () => {
    professionalView();
    fireEvent.click(screen.getByRole("button", { name: /Adicionar adendo à evolução de 02\/10\/2031/ }));
    fireEvent.change(await screen.findByLabelText("Adendo"), { target: { value: "Correção: lado direito." } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar adendo" }));
    await waitFor(() => expect(mocks.addAddendumAction).toHaveBeenCalledTimes(1));
    const formData = mocks.addAddendumAction.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(formData.entries())).toEqual({ noteId: NOTE_FINAL, body: "Correção: lado direito." });
  });
});

describe("RecordSection: admin (somente leitura)", () => {
  const adminView = () => render(<RecordSection role="admin" patientName="Paciente Teste" notes={notes} pending={[]} />);

  it("lê todas as evoluções com o nome do profissional e a marca de rascunho, sem nenhum botão de escrever", () => {
    adminView();
    expect(screen.getByText("Texto do rascunho")).toBeInTheDocument();
    expect(screen.getByText("Texto finalizado")).toBeInTheDocument();
    expect(screen.getByText("Texto do adendo")).toBeInTheDocument();
    expect(screen.getAllByText(/Ana Fisio/).length).toBeGreaterThan(0);
    expect(screen.getByText("Rascunho")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("sem evolução nenhuma, diz isso", () => {
    render(<RecordSection role="admin" patientName="Paciente Teste" notes={[]} pending={[]} />);
    expect(screen.getByText("Nenhuma evolução registrada.")).toBeInTheDocument();
  });
});

describe("RecordSection: profissional sem nada", () => {
  it("sem evolução e sem atendimento pendente, explica o que falta", () => {
    render(<RecordSection role="professional" patientName="Paciente Teste" notes={[]} pending={[]} />);
    expect(screen.getByText(/Nenhuma evolução/)).toBeInTheDocument();
  });
});
