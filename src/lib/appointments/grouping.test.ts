import { describe, expect, it } from "vitest";

import { groupByDate, groupByProfessional } from "./grouping";

type Item = {
  id: string;
  professionalId: string;
  professionalName: string;
  specialty: "physiotherapy" | "dentistry" | "psychology";
  startsAt: Date;
};

let counter = 0;
const item = (overrides: Omit<Partial<Item>, "startsAt"> & { startsAt: string }): Item => {
  counter += 1;
  const { startsAt, ...rest } = overrides;
  return {
    id: `id-${String(counter).padStart(3, "0")}`,
    professionalId: "p1",
    professionalName: "Ana",
    specialty: "physiotherapy",
    startsAt: new Date(startsAt),
    ...rest,
  };
};

describe("groupByProfessional", () => {
  it("agrupa por profissional, ordena por especialidade e nome, e os atendimentos por horário", () => {
    const late = item({ startsAt: "2026-11-23T15:00:00Z", professionalId: "p1" });
    const early = item({ startsAt: "2026-11-23T12:00:00Z", professionalId: "p1" });
    const dentist = item({
      startsAt: "2026-11-23T13:00:00Z",
      professionalId: "p2",
      professionalName: "Bruno",
      specialty: "dentistry",
    });
    const groups = groupByProfessional([late, dentist, early]);
    // Ordem das especialidades do catálogo (Fisioterapia, Odontologia, Psicologia), depois o nome.
    expect(groups.map((g) => g.professionalId)).toEqual(["p1", "p2"]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual([early.id, late.id]);
  });

  it("na mesma especialidade ordena pelo nome (sem diferenciar acento)", () => {
    const zeca = item({ startsAt: "2026-11-23T12:00:00Z", professionalId: "p3", professionalName: "Zeca" });
    const alvaro = item({ startsAt: "2026-11-23T13:00:00Z", professionalId: "p4", professionalName: "Álvaro" });
    expect(groupByProfessional([zeca, alvaro]).map((g) => g.professionalName)).toEqual(["Álvaro", "Zeca"]);
  });

  it("desempata o mesmo horário pelo id (ordem estável)", () => {
    const a = item({ startsAt: "2026-11-23T12:00:00Z" });
    const b = item({ startsAt: "2026-11-23T12:00:00Z" });
    expect(groupByProfessional([b, a])[0]?.items.map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it("lista vazia dá nenhum grupo", () => {
    expect(groupByProfessional([])).toEqual([]);
  });

  it("não altera a lista recebida", () => {
    const list = [item({ startsAt: "2026-11-23T15:00:00Z" }), item({ startsAt: "2026-11-23T12:00:00Z" })];
    const copy = [...list];
    groupByProfessional(list);
    expect(list).toEqual(copy);
  });
});

describe("groupByDate (dia de Brasília, não o UTC)", () => {
  const dates = ["2026-11-23", "2026-11-24", "2026-11-25"];

  it("devolve um grupo por data pedida, inclusive os vazios, na ordem pedida", () => {
    const monday = item({ startsAt: "2026-11-23T12:00:00Z" });
    const groups = groupByDate([monday], dates);
    expect(groups.map((g) => g.date)).toEqual(dates);
    expect(groups.map((g) => g.items.length)).toEqual([1, 0, 0]);
  });

  it("atendimento às 22h de Brasília (01h UTC do dia seguinte) fica no dia de Brasília", () => {
    const night = item({ startsAt: "2026-11-24T01:00:00Z" }); // 22:00 de 23/11 em Brasília
    const groups = groupByDate([night], dates);
    expect(groups[0]?.items).toEqual([night]);
    expect(groups[1]?.items).toEqual([]);
  });

  it("atendimento à 00h30 de Brasília (03h30 UTC) já é do dia novo", () => {
    const earlyBird = item({ startsAt: "2026-11-24T03:30:00Z" });
    const groups = groupByDate([earlyBird], dates);
    expect(groups[0]?.items).toEqual([]);
    expect(groups[1]?.items).toEqual([earlyBird]);
  });

  it("ordena por horário dentro do dia e ignora o que está fora das datas pedidas", () => {
    const b = item({ startsAt: "2026-11-23T17:00:00Z" });
    const a = item({ startsAt: "2026-11-23T11:00:00Z" });
    const outside = item({ startsAt: "2026-12-30T11:00:00Z" });
    const groups = groupByDate([b, outside, a], dates);
    expect(groups[0]?.items).toEqual([a, b]);
    expect(groups.flatMap((g) => g.items)).not.toContain(outside);
  });
});
