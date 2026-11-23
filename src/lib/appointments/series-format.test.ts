import { describe, expect, it } from "vitest";

import {
  createdSummaryText,
  formatSeriesSlot,
  previewSummary,
  previewSummaryText,
  seriesBadgeText,
  seriesProgressText,
  unmovedSummaryText,
} from "./series-format";

describe("formatSeriesSlot", () => {
  it("mostra o dia da semana, a data e a hora de Brasília (não a de UTC)", () => {
    // 2031-06-02 17:00 UTC = 14:00 em Brasília, segunda-feira.
    expect(formatSeriesSlot("2031-06-02T17:00:00.000Z")).toBe("Segunda-feira, 02/06/2031 às 14:00");
  });

  it("a virada de dia em UTC não muda o dia local", () => {
    // 2031-06-03 01:30 UTC = 2031-06-02 22:30 em Brasília (ainda segunda).
    expect(formatSeriesSlot("2031-06-03T01:30:00.000Z")).toBe("Segunda-feira, 02/06/2031 às 22:30");
  });

  it("domingo e virada de ano", () => {
    expect(formatSeriesSlot("2031-12-28T13:05:00.000Z")).toBe("Domingo, 28/12/2031 às 10:05");
  });
});

describe("previewSummary", () => {
  const ok = { startsAt: "2031-06-02T17:00:00.000Z", reason: null } as const;
  const bad = { startsAt: "2031-06-09T17:00:00.000Z", reason: "time-off" } as const;

  it("conta quantas datas cabem e quantas não", () => {
    expect(previewSummary([ok, bad, ok])).toEqual({ fits: 2, skipped: 1, total: 3 });
  });

  it("lista vazia", () => {
    expect(previewSummary([])).toEqual({ fits: 0, skipped: 0, total: 0 });
  });
});

describe("seriesProgressText", () => {
  const base = { id: "s", position: 3, total: 10, done: 2, noShow: 0, remaining: 7, cancelled: 0 };

  it("posição, realizadas e restantes (faltas e canceladas só aparecem quando existem)", () => {
    expect(seriesProgressText(base)).toBe("Sessão 3 de 10 · 2 realizadas · 7 restantes");
    expect(seriesProgressText({ ...base, noShow: 1, cancelled: 2 })).toBe("Sessão 3 de 10 · 2 realizadas · 1 falta · 7 restantes · 2 canceladas");
  });

  it("singular e zero", () => {
    expect(seriesProgressText({ ...base, done: 1, remaining: 1, noShow: 1, cancelled: 1 })).toBe(
      "Sessão 3 de 10 · 1 realizada · 1 falta · 1 restante · 1 cancelada",
    );
    expect(seriesProgressText({ ...base, done: 0, remaining: 0 })).toBe("Sessão 3 de 10 · 0 realizadas · 0 restantes");
  });

  it("a sessão cancelada não tem posição", () => {
    expect(seriesProgressText({ ...base, position: null, cancelled: 1 })).toBe("Sessão cancelada · 2 realizadas · 7 restantes · 1 cancelada");
  });
});

describe("seriesBadgeText", () => {
  it("o selo do cartão: 'Série 3/10'; sem posição (cancelada) só 'Série'", () => {
    expect(seriesBadgeText({ position: 3, total: 10 })).toBe("Série 3/10");
    expect(seriesBadgeText({ position: null, total: 9 })).toBe("Série");
  });
});

describe("previewSummaryText", () => {
  const ok = { reason: null } as const;
  const bad = { reason: "time-off" } as const;

  it("singular e plural, com e sem datas que não cabem", () => {
    expect(previewSummaryText([ok, bad, bad])).toBe("1 de 3 datas cabem; 2 não cabem.");
    expect(previewSummaryText([ok, bad])).toBe("1 de 2 datas cabem; 1 não cabe.");
    expect(previewSummaryText([ok])).toBe("1 de 1 data cabe.");
    expect(previewSummaryText([ok, ok])).toBe("2 de 2 datas cabem.");
    expect(previewSummaryText([])).toBe("0 de 0 datas cabem.");
  });
});

describe("createdSummaryText", () => {
  it("concorda no singular e no plural", () => {
    expect(createdSummaryText(1, 1)).toBe("1 sessão criada. Esta data não coube e ficou de fora:");
    expect(createdSummaryText(2, 1)).toBe("2 sessões criadas. Esta data não coube e ficou de fora:");
    expect(createdSummaryText(2, 3)).toBe("2 sessões criadas. Estas 3 datas não couberam e ficaram de fora:");
  });
});

describe("unmovedSummaryText", () => {
  it("concorda no singular e no plural", () => {
    expect(unmovedSummaryText(1, 1)).toBe("1 sessão remarcada. Esta sessão não coube no novo horário e ficou onde estava:");
    expect(unmovedSummaryText(3, 2)).toBe("3 sessões remarcadas. Estas 2 sessões não couberam no novo horário e ficaram onde estavam:");
    expect(unmovedSummaryText(0, 1)).toBe("Nenhuma sessão remarcada. Esta sessão não coube no novo horário e ficou onde estava:");
  });
});
