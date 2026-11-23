import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SeriesPreviewList } from "./series-preview-list";

const rows = [
  { startsAt: "2031-06-02T17:00:00.000Z", reason: null },
  { startsAt: "2031-06-09T17:00:00.000Z", reason: "time-off" },
  { startsAt: "2031-06-16T17:00:00.000Z", reason: "conflict-patient" },
] as const;

// Sem `globals`, o Testing Library não limpa sozinho entre os testes.
afterEach(cleanup);

describe("SeriesPreviewList", () => {
  it("resume quantas datas cabem", () => {
    render(<SeriesPreviewList rows={[...rows]} />);
    expect(screen.getByText("1 de 3 datas cabem; 2 não cabem.")).toBeInTheDocument();
  });

  it("uma linha por data, com o dia da semana, a data e a hora de Brasília", () => {
    render(<SeriesPreviewList rows={[...rows]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Segunda-feira, 02/06/2031 às 14:00");
  });

  it("não depende só de cor: cada linha diz em texto se cabe ou o motivo", () => {
    render(<SeriesPreviewList rows={[...rows]} />);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByText("Cabe")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Folga ou bloqueio do profissional")).toBeInTheDocument();
    expect(within(items[2]!).getByText("O paciente já tem atendimento")).toBeInTheDocument();
  });

  it("singular e plural no resumo", () => {
    render(<SeriesPreviewList rows={[rows[0], rows[1]]} />);
    expect(screen.getByText("1 de 2 datas cabem; 1 não cabe.")).toBeInTheDocument();
  });

  it("tudo cabe: sem a parte das que não cabem", () => {
    render(<SeriesPreviewList rows={[rows[0]]} />);
    expect(screen.getByText("1 de 1 data cabe.")).toBeInTheDocument();
  });
});

it("a lista não cria uma região de status própria (a persistente fica na seção)", () => {
  render(<SeriesPreviewList rows={[...rows]} />);
  expect(screen.queryByRole("status")).toBeNull();
});
