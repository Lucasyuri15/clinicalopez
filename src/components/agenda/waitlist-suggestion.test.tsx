import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WaitlistSuggestion as Suggestion } from "@/server/appointments/actions";

const mocks = vi.hoisted(() => ({ bookFromWaitlistAction: vi.fn() }));
// A ação é "use server" (só roda no servidor): aqui entra uma dublê com o mesmo contrato.
vi.mock("@/server/waitlist/actions", () => ({ bookFromWaitlistAction: mocks.bookFromWaitlistAction }));

import { WaitlistSuggestion } from "./waitlist-suggestion";

const PROFESSIONAL = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const suggestion: Suggestion = {
  professionalId: PROFESSIONAL,
  startsAt: "2031-06-02T17:00:00.000Z", // 14:00 em Brasília
  candidates: [
    { entryId: "55555555-5555-4555-8555-555555555551", patientName: "Paciente Um", serviceName: "Sessão", endsAt: "2031-06-02T17:50:00.000Z" },
    { entryId: "55555555-5555-4555-8555-555555555552", patientName: "Paciente Dois", serviceName: "Avaliação", endsAt: "2031-06-02T18:00:00.000Z" },
  ],
};

// Sem `globals`, o Testing Library não limpa sozinho entre os testes.
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  // O jsdom não implementa `scrollIntoView`, que o formulário chama ao mostrar um erro.
  Element.prototype.scrollIntoView = vi.fn();
  mocks.bookFromWaitlistAction.mockResolvedValue({ success: true });
});

describe("WaitlistSuggestion", () => {
  it("diz que o horário ficou livre e quantas pessoas da espera cabem (singular e plural)", () => {
    const { unmount } = render(<WaitlistSuggestion suggestion={suggestion} onClose={() => {}} />);
    expect(screen.getByText(/Segunda-feira, 02\/06\/2031 às 14:00 ficou livre/)).toBeInTheDocument();
    expect(screen.getByText(/2 pessoas da lista de espera cabem/)).toBeInTheDocument();
    unmount();

    render(<WaitlistSuggestion suggestion={{ ...suggestion, candidates: [suggestion.candidates[0]!] }} onClose={() => {}} />);
    expect(screen.getByText(/1 pessoa da lista de espera cabe/)).toBeInTheDocument();
  });

  it("um cartão por candidato, em ordem, com nome, serviço e a faixa de horário de Brasília", () => {
    render(<WaitlistSuggestion suggestion={suggestion} onClose={() => {}} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Paciente Um");
    expect(items[0]).toHaveTextContent("Sessão");
    expect(items[0]).toHaveTextContent("14:00–14:50");
    expect(items[1]).toHaveTextContent("Paciente Dois");
    expect(items[1]).toHaveTextContent("14:00–15:00");
  });

  it("o botão Agendar tem a pessoa e o serviço no rótulo (duas esperas da mesma pessoa não ficam iguais)", () => {
    render(<WaitlistSuggestion suggestion={suggestion} onClose={() => {}} />);
    const button = screen.getByRole("button", { name: "Agendar Paciente Um, Sessão" });
    expect(button).toHaveTextContent("Agendar"); // o texto visível está dentro do rótulo
    expect(screen.getByRole("button", { name: "Agendar Paciente Dois, Avaliação" })).toBeInTheDocument();
  });

  it("Agendar manda SÓ a espera, o profissional e o início; no sucesso fecha a gaveta", async () => {
    const onClose = vi.fn();
    render(<WaitlistSuggestion suggestion={suggestion} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Agendar Paciente Dois, Avaliação" }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.bookFromWaitlistAction).toHaveBeenCalledTimes(1);
    const formData = mocks.bookFromWaitlistAction.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(formData.entries())).toEqual({
      entryId: "55555555-5555-4555-8555-555555555552",
      professionalId: PROFESSIONAL,
      startsAt: "2031-06-02T17:00:00.000Z",
    });
  });

  it("uma recusa aparece no cartão certo, em texto, e a gaveta continua aberta para tentar outra pessoa", async () => {
    const onClose = vi.fn();
    mocks.bookFromWaitlistAction.mockResolvedValue({ error: "O paciente já tem um atendimento nesse horário." });
    render(<WaitlistSuggestion suggestion={suggestion} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Agendar Paciente Um, Sessão" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("O paciente já tem um atendimento nesse horário.");
    expect(within(screen.getAllByRole("listitem")[0]!).getByRole("alert")).toBe(alert);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Agendar Paciente Dois, Avaliação" })).toBeEnabled();
  });

  it("Concluir fecha sem agendar ninguém", () => {
    const onClose = vi.fn();
    render(<WaitlistSuggestion suggestion={suggestion} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.bookFromWaitlistAction).not.toHaveBeenCalled();
  });
});
