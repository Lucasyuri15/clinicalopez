import { describe, expect, it } from "vitest";

import { formatCpf, isValidCpf, normalizeCpf } from "./cpf";

// CPFs FICTÍCIOS com dígitos verificadores corretos (usados só para testar o algoritmo).
const VALID = "52998224725";
const VALID_2 = "11144477735";

describe("isValidCpf", () => {
  it("aceita CPFs com dígitos verificadores corretos", () => {
    expect(isValidCpf(VALID)).toBe(true);
    expect(isValidCpf(VALID_2)).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(isValidCpf("52998224724")).toBe(false); // 2º dígito
    expect(isValidCpf("52998224715")).toBe(false); // 1º dígito
  });

  it("recusa sequências de um só dígito (passam na conta, mas não existem)", () => {
    for (let d = 0; d <= 9; d += 1) {
      expect(isValidCpf(String(d).repeat(11)), `${d}`).toBe(false);
    }
  });

  it("recusa tamanho errado e não-dígitos", () => {
    expect(isValidCpf("")).toBe(false);
    expect(isValidCpf("5299822472")).toBe(false); // 10
    expect(isValidCpf("529982247255")).toBe(false); // 12
    expect(isValidCpf("5299822472a")).toBe(false);
    expect(isValidCpf("529.982.247-25")).toBe(false); // sem normalizar
  });

  it("recusa dígitos de outros alfabetos (\\d de JavaScript é só ASCII)", () => {
    expect(isValidCpf("٥٢٩٩٨٢٢٤٧٢٥")).toBe(false);
  });
});

describe("normalizeCpf", () => {
  it("aceita o que se digita e devolve só os dígitos", () => {
    expect(normalizeCpf("529.982.247-25")).toBe(VALID);
    expect(normalizeCpf("52998224725")).toBe(VALID);
    expect(normalizeCpf("  529 982 247 25 ")).toBe(VALID);
    expect(normalizeCpf("529.982.247.25")).toBe(VALID);
  });

  it("devolve null para CPF inválido, vazio ou com lixo no meio", () => {
    expect(normalizeCpf("")).toBeNull();
    expect(normalizeCpf("   ")).toBeNull();
    expect(normalizeCpf("529.982.247-24")).toBeNull();
    expect(normalizeCpf("111.111.111-11")).toBeNull();
    expect(normalizeCpf("529.982.247-25abc")).toBeNull();
    expect(normalizeCpf("CPF 52998224725")).toBeNull();
    expect(normalizeCpf("529,982,247-25")).toBeNull();
  });
});

describe("formatCpf", () => {
  it("formata 11 dígitos como 000.000.000-00", () => {
    expect(formatCpf(VALID)).toBe("529.982.247-25");
  });

  it("devolve o texto como está se não forem 11 dígitos", () => {
    expect(formatCpf("123")).toBe("123");
    expect(formatCpf("")).toBe("");
  });
});
