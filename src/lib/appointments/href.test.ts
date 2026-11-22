import { describe, expect, it } from "vitest";

import { agendaHref } from "./href";
import type { AgendaFilters } from "./schemas";

const PROFESSIONAL = "3f0c1d5e-7a52-4c1b-9d33-5f6a8e2b1c40";
const base: AgendaFilters = { view: "day", date: "2026-11-23", professional: null, specialty: null };

describe("agendaHref (endereço da agenda com os filtros)", () => {
  it("sempre leva a visão e a data; filtros vazios ficam de fora", () => {
    expect(agendaHref(base)).toBe("/agenda?view=day&date=2026-11-23");
  });

  it("leva profissional e especialidade quando existem", () => {
    const href = agendaHref({ ...base, professional: PROFESSIONAL, specialty: "physiotherapy" });
    expect(href).toBe(`/agenda?view=day&date=2026-11-23&professional=${PROFESSIONAL}&specialty=physiotherapy`);
  });

  it("troca só o que veio em overrides e preserva o resto", () => {
    const filters = { ...base, professional: PROFESSIONAL };
    expect(agendaHref(filters, { date: "2026-11-24" })).toBe(
      `/agenda?view=day&date=2026-11-24&professional=${PROFESSIONAL}`,
    );
    expect(agendaHref(filters, { view: "week" })).toBe(
      `/agenda?view=week&date=2026-11-23&professional=${PROFESSIONAL}`,
    );
  });

  it("limpar um filtro com null o remove do endereço", () => {
    const filters = { ...base, professional: PROFESSIONAL, specialty: "dentistry" as const };
    expect(agendaHref(filters, { professional: null })).toBe("/agenda?view=day&date=2026-11-23&specialty=dentistry");
    expect(agendaHref(filters, { professional: null, specialty: null })).toBe("/agenda?view=day&date=2026-11-23");
  });

  it("não altera o objeto recebido", () => {
    const filters = Object.freeze({ ...base });
    expect(() => agendaHref(filters, { date: "2026-12-01" })).not.toThrow();
    expect(filters.date).toBe("2026-11-23");
  });
});
