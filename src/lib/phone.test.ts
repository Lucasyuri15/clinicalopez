import { describe, expect, it } from "vitest";

import { formatPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["(11) 91234-5678", "11912345678"],
    ["11 91234 5678", "11912345678"],
    ["11912345678", "11912345678"],
    ["+55 11 91234-5678", "11912345678"],
    ["55 (11) 91234-5678", "11912345678"],
    ["(11) 3456-7890", "1134567890"],
    ["+55 (21) 2345-6789", "2123456789"],
    ["  (85) 98765.4321  ", "85987654321"],
  ])("aceita %j como %j (só dígitos, sem código do país)", (input, digits) => {
    expect(normalizePhone(input)).toBe(digits);
  });

  it.each([
    [""],
    ["   "],
    ["abc"],
    ["11 9abc-5678"],
    ["91234-5678"], // sem DDD
    ["(01) 91234-5678"], // DDD começa com zero
    ["(10) 91234-5678"], // DDD inexistente (10)
    ["(11) 81234-5678"], // 11 dígitos: o celular começa com 9
    ["(11) 1234-5678"], // fixo começa com 2 a 5
    ["(11) 6234-5678"],
    ["(11) 91234-567"], // curto
    ["(11) 91234-56789"], // longo
    ["+1 415 555 2671"], // outro país
    ["0 11 91234-5678"], // prefixo de operadora
    ["11 91234-5678 ramal 2"],
    ["١١٩١٢٣٤٥٦٧٨"], // dígitos que não são ASCII
  ])("recusa %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("formatPhone", () => {
  it("formata celular e fixo", () => {
    expect(formatPhone("11912345678")).toBe("(11) 91234-5678");
    expect(formatPhone("1134567890")).toBe("(11) 3456-7890");
  });

  it("devolve o texto como está se não for um número válido (nunca estoura na tela)", () => {
    expect(formatPhone("123")).toBe("123");
    expect(formatPhone("")).toBe("");
  });

  it("ida e volta: o formatado volta a ser lido igual", () => {
    for (const digits of ["11912345678", "1134567890", "85987654321"]) {
      expect(normalizePhone(formatPhone(digits))).toBe(digits);
    }
  });
});
