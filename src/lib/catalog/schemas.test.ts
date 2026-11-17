import { describe, expect, it } from "vitest";

import {
  insuranceInputSchema,
  PRICE_MAX_CENTS,
  priceInputSchema,
  serviceInputSchema,
} from "./schemas";

const ID = "6f1c1b5e-8a3f-4a0e-9d57-2f6c5f0b7a11";
const OTHER = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";

const service = (over: Record<string, unknown> = {}) => ({
  name: "Sessão de fisioterapia",
  specialty: "physiotherapy",
  durationMinutes: "50",
  ...over,
});

describe("serviceInputSchema", () => {
  it("aceita um serviço válido e converte a duração para número", () => {
    expect(serviceInputSchema.parse(service())).toEqual({
      name: "Sessão de fisioterapia",
      specialty: "physiotherapy",
      durationMinutes: 50,
    });
  });

  it("apara o nome e junta espaços repetidos", () => {
    expect(serviceInputSchema.parse(service({ name: "  Limpeza   dental  " })).name).toBe(
      "Limpeza dental",
    );
  });

  it("aceita o id (edição) só se for UUID, com mensagem em pt-BR", () => {
    expect(serviceInputSchema.parse(service({ id: ID })).id).toBe(ID);
    const bad = serviceInputSchema.safeParse(service({ id: "1" }));
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe("Registro inválido.");
  });

  it("normaliza o nome para NFC (ç digitado e ç colado decomposto são o MESMO nome)", () => {
    const composed = "Sess\u00e3o de fisioterapia"; // ã
    const decomposed = "Sess\u0061\u0303o de fisioterapia"; // a + til combinante
    expect(composed).not.toBe(decomposed);
    expect(serviceInputSchema.parse(service({ name: decomposed })).name).toBe(composed);
    expect(insuranceInputSchema.parse({ name: decomposed }).name).toBe(composed);
  });

  it.each([
    ["nome vazio", { name: "   " }],
    ["nome grande demais", { name: "a".repeat(121) }],
    ["especialidade desconhecida", { specialty: "cardiology" }],
    ["duração abaixo do mínimo", { durationMinutes: "4" }],
    ["duração acima do máximo", { durationMinutes: "481" }],
    ["duração não inteira", { durationMinutes: "30,5" }],
    ["duração vazia", { durationMinutes: "" }],
    ["duração negativa", { durationMinutes: "-30" }],
    ["duração em texto", { durationMinutes: "meia hora" }],
  ])("recusa %s", (_label, over) => {
    expect(serviceInputSchema.safeParse(service(over)).success).toBe(false);
  });

  it("aceita os limites exatos da duração (5 e 480)", () => {
    expect(serviceInputSchema.safeParse(service({ durationMinutes: "5" })).success).toBe(true);
    expect(serviceInputSchema.safeParse(service({ durationMinutes: "480" })).success).toBe(true);
  });
});

describe("insuranceInputSchema", () => {
  it("aceita e normaliza o nome", () => {
    expect(insuranceInputSchema.parse({ name: "  Plano   Fictício " })).toEqual({
      name: "Plano Fictício",
    });
  });

  it.each([[""], ["   "], ["a".repeat(121)]])("recusa o nome %j", (name) => {
    expect(insuranceInputSchema.safeParse({ name }).success).toBe(false);
  });
});

describe("priceInputSchema", () => {
  it("valor particular: convênio vazio vira null e o valor vira centavos", () => {
    expect(
      priceInputSchema.parse({ serviceId: ID, insuranceId: "", price: "R$ 150,00" }),
    ).toEqual({ serviceId: ID, insuranceId: null, priceCents: 15000 });
  });

  it("valor de convênio: guarda o convênio", () => {
    expect(
      priceInputSchema.parse({ serviceId: ID, insuranceId: OTHER, price: "99,90" }),
    ).toEqual({ serviceId: ID, insuranceId: OTHER, priceCents: 9990 });
  });

  it("aceita zero e o teto exato", () => {
    expect(
      priceInputSchema.safeParse({ serviceId: ID, insuranceId: "", price: "0" }).success,
    ).toBe(true);
    const teto = (PRICE_MAX_CENTS / 100).toFixed(2).replace(".", ",");
    expect(
      priceInputSchema.safeParse({ serviceId: ID, insuranceId: "", price: teto }).success,
    ).toBe(true);
  });

  it.each([
    ["serviço inválido", { serviceId: "x", insuranceId: "", price: "10" }],
    ["convênio inválido", { serviceId: ID, insuranceId: "x", price: "10" }],
    ["valor vazio", { serviceId: ID, insuranceId: "", price: "" }],
    ["valor negativo", { serviceId: ID, insuranceId: "", price: "-1" }],
    ["valor com 3 casas", { serviceId: ID, insuranceId: "", price: "1,999" }],
    ["valor acima do teto", { serviceId: ID, insuranceId: "", price: "100.000,01" }],
  ])("recusa %s", (_label, input) => {
    expect(priceInputSchema.safeParse(input).success).toBe(false);
  });
});
