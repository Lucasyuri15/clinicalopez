import { describe, expect, it } from "vitest";

import { zonedToUtc } from "@/lib/datetime";

import { createSeriesSchema, renewSeriesSchema } from "./schemas";

const ID = {
  patient: "11111111-1111-4111-8111-111111111111",
  professional: "22222222-2222-4222-8222-222222222222",
  service: "33333333-3333-4333-8333-333333333333",
  series: "44444444-4444-4444-8444-444444444444",
};

const valid = {
  patientId: ID.patient,
  professionalId: ID.professional,
  serviceId: ID.service,
  date: "2026-11-24",
  startTime: "14:00",
  durationMinutes: "50",
  weekdays: ["2", "4"],
  count: "10",
};

const parse = (input: Record<string, unknown>) => createSeriesSchema().safeParse({ ...valid, ...input });
const messages = (result: ReturnType<typeof parse>) =>
  result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [String(issue.path[0]), issue.message]));

describe("createSeriesSchema", () => {
  it("aceita um pedido válido e devolve tipos prontos, com as datas já calculadas", () => {
    const result = parse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      patientId: ID.patient,
      professionalId: ID.professional,
      serviceId: ID.service,
      firstDate: "2026-11-24",
      startTime: "14:00",
      durationMinutes: 50,
      weekdays: [2, 4],
      count: 10,
    });
    expect(result.data.occurrences).toHaveLength(10);
    expect(result.data.occurrences[0]?.startsAt).toEqual(zonedToUtc("2026-11-24", "14:00"));
  });

  it("dias da semana: ordena, tira repetidos e exige ao menos um", () => {
    const result = parse({ weekdays: ["4", "2", "2"] });
    expect(result.success && result.data.weekdays).toEqual([2, 4]);
    expect(messages(parse({ weekdays: [] })).weekdays).toBe("Escolha ao menos um dia da semana.");
    expect(messages(parse({ weekdays: ["7"] })).weekdays).toBe("Dia da semana inválido.");
    expect(messages(parse({ weekdays: ["x"] })).weekdays).toBe("Dia da semana inválido.");
  });

  it("número de sessões: de 2 a 60, só inteiros", () => {
    for (const bad of ["1", "0", "61", "2.5", "-3", "abc", ""]) {
      expect(messages(parse({ count: bad })).count).toBe("Informe de 2 a 60 sessões.");
    }
    expect(parse({ count: "2" }).success).toBe(true);
    expect(parse({ count: "60", weekdays: ["0", "1", "2", "3", "4", "5", "6"] }).success).toBe(true);
  });

  it("recusa série que passa de 1 ano", () => {
    // 60 sessões de um dia por semana são ~14 meses.
    expect(messages(parse({ count: "60", weekdays: ["2"] })).count).toBe("A série passa de 1 ano. Reduza o número de sessões.");
  });

  it("valida ids, data, horário e duração com as mensagens da agenda", () => {
    const bad = messages(parse({ patientId: "x", professionalId: "y", serviceId: "z", date: "2026-02-30", startTime: "14:03", durationMinutes: "7" }));
    expect(bad.patientId).toBe("Paciente inválido.");
    expect(bad.professionalId).toBe("Profissional inválido.");
    expect(bad.serviceId).toBe("Serviço inválido.");
    expect(bad.date).toBe("Data inválida.");
    expect(bad.startTime).toMatch(/5 em 5 minutos/);
    expect(bad.durationMinutes).toMatch(/duração/);
  });

  it("recusa série que termina depois do limite da agenda (2100)", () => {
    // Começa em 2100-12-14 (terça), semanal, 10 sessões: as últimas caem em 2101, que o banco recusa.
    expect(messages(parse({ date: "2100-12-14", weekdays: ["2"], count: "10" })).count).toBe("A série passa da data máxima da agenda (31/12/2100).");
    expect(parse({ date: "2100-12-14", weekdays: ["2"], count: "3" }).success).toBe(true);
  });

  it("data de partida no passado não é recusada aqui: cada sessão é classificada na prévia", () => {
    expect(parse({ date: "2020-01-07" }).success).toBe(true);
  });

  it("as mensagens de erro nunca repetem o que foi digitado", () => {
    const text = JSON.stringify(messages(parse({ patientId: "SEGREDO-123", date: "SEGREDO-456", count: "SEGREDO-789" })));
    expect(text).not.toContain("SEGREDO");
  });
});

describe("renewSeriesSchema", () => {
  const renew = (input: Record<string, unknown>) =>
    renewSeriesSchema().safeParse({
      seriesId: ID.series,
      date: "2026-11-24",
      startTime: "14:00",
      durationMinutes: "50",
      weekdays: ["2"],
      count: "4",
      ...input,
    });

  it("troca os três ids pelo id da série e valida o mesmo padrão", () => {
    const result = renew({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({ seriesId: ID.series, weekdays: [2], count: 4 });
    expect(result.data.occurrences).toHaveLength(4);
  });

  it("recusa série inválida e padrão inválido", () => {
    const bad = renew({ seriesId: "x", weekdays: [], count: "1" });
    expect(bad.success).toBe(false);
    if (bad.success) return;
    const paths = bad.error.issues.map((issue) => issue.path[0]);
    expect(paths).toEqual(expect.arrayContaining(["seriesId", "weekdays", "count"]));
  });
});
