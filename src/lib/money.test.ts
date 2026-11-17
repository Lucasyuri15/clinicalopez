import { describe, expect, test } from "vitest";
import { formatBRL, formatCentsForInput, parseBRLToCents } from "./money";

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

describe("parseBRLToCents", () => {
  test.each([
    ["120", 12000],
    ["120,5", 12050],
    ["120,50", 12050],
    ["0,05", 5],
    ["0", 0],
    ["1.200,00", 120000],
    ["1.234.567,89", 123456789],
    ["R$ 1.200,00", 120000],
    ["R$120,50", 12050],
    [`R$${NBSP}1.200,00`, 120000],
    ["  80  ", 8000],
  ])("aceita %j como %i centavos", (input, cents) => {
    expect(parseBRLToCents(input)).toBe(cents);
  });

  test.each([
    [""],
    ["   "],
    ["abc"],
    ["R$"],
    ["-10"],
    ["-10,00"],
    ["10,505"], // mais de 2 casas
    ["10,"], // vírgula sem centavos
    [",50"],
    ["1200.50"], // ponto decimal: ambíguo com o milhar, recusado
    ["1.20"],
    ["12.00.00"],
    ["1,200,00"],
    ["1 200,00"], // espaço no meio
    ["10,00,00"],
    ["1e3"],
    ["R$ R$ 10"],
  ])("recusa %j", (input) => {
    expect(parseBRLToCents(input)).toBeNull();
  });
});

describe("formatCentsForInput", () => {
  test.each([
    [15000, "150,00"],
    [12050, "120,50"],
    [5, "0,05"],
    [0, "0,00"],
    [123456789, "1234567,89"], // sem separador de milhar: é o que se volta a digitar no campo
  ])("%i centavos viram %j", (cents, text) => {
    expect(formatCentsForInput(cents)).toBe(text);
  });

  test("volta a ser lido igual por parseBRLToCents", () => {
    for (const cents of [0, 5, 99, 100, 15050, 10_000_000]) {
      expect(parseBRLToCents(formatCentsForInput(cents))).toBe(cents);
    }
  });

  test("recusa o que não são centavos inteiros não negativos", () => {
    expect(() => formatCentsForInput(-1)).toThrow(RangeError);
    expect(() => formatCentsForInput(1.5)).toThrow(RangeError);
  });
});
