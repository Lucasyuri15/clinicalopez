import { describe, expect, test } from "vitest";
import { formatBRL } from "./money";

const NBSP = " ";

describe("formatBRL", () => {
  test("formata centavos inteiros em reais", () => {
    expect(formatBRL(123456)).toBe(`R$${NBSP}1.234,56`);
  });

  test("formata zero", () => {
    expect(formatBRL(0)).toBe(`R$${NBSP}0,00`);
  });

  test("preenche centavos com zero à esquerda", () => {
    expect(formatBRL(5)).toBe(`R$${NBSP}0,05`);
  });

  test("formata valores negativos (estornos/descontos)", () => {
    expect(formatBRL(-1234)).toBe(`-R$${NBSP}12,34`);
  });

  test("formata valores grandes com separador de milhar", () => {
    expect(formatBRL(100000000)).toBe(`R$${NBSP}1.000.000,00`);
  });

  test("não exibe sinal negativo para zero negativo", () => {
    expect(formatBRL(-0)).toBe(`R$${NBSP}0,00`);
  });

  test("rejeita valores acima do limite de inteiros seguros (perda de precisão)", () => {
    expect(() => formatBRL(1e20)).toThrow(RangeError);
    expect(() => formatBRL(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  test("rejeita valores que não são centavos inteiros", () => {
    expect(() => formatBRL(10.5)).toThrow(RangeError);
    expect(() => formatBRL(Number.NaN)).toThrow(RangeError);
    expect(() => formatBRL(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
