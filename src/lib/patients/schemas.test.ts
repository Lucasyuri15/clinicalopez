import { describe, expect, it } from "vitest";

import { createPatientInputSchema, MAX_PROFESSIONALS } from "./schemas";

const TODAY = "2026-11-18";
const schema = createPatientInputSchema(TODAY);

// Dados FICTÍCIOS. CPFs com dígitos verificadores corretos, só para testar o algoritmo.
const CPF = "529.982.247-25";
const CPF_DIGITS = "52998224725";
const OTHER_CPF = "111.444.777-35";
const GUID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

const base = {
  fullName: "Maria da Silva Teste",
  birthDate: "1990-05-10",
  phone: "(11) 91234-5678",
  email: "",
  noCpf: "",
  cpf: CPF,
  noCpfReason: "",
  cep: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  state: "",
  insuranceId: "",
  insuranceCard: "",
  guardianName: "",
  guardianRelationship: "",
  guardianPhone: "",
  guardianCpf: "",
  adminNotes: "",
  professionalIds: [] as string[],
};

const parse = (overrides: Record<string, unknown> = {}) => schema.safeParse({ ...base, ...overrides });

/** Mensagens por campo (primeiro nome do caminho), para os testes dizerem ONDE o erro aparece. */
function errors(overrides: Record<string, unknown> = {}): Record<string, string> {
  const result = parse(overrides);
  if (result.success) return {};
  const out: Record<string, string> = {};
  for (const issue of result.error.issues) out[String(issue.path[0] ?? "_")] ??= issue.message;
  return out;
}

function ok(overrides: Record<string, unknown> = {}) {
  const result = parse(overrides);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data;
}

describe("cadastro mínimo", () => {
  it("normaliza e devolve tipos prontos (vazios viram null, CPF só dígitos)", () => {
    expect(ok()).toEqual({
      fullName: "Maria da Silva Teste",
      birthDate: "1990-05-10",
      phone: "11912345678",
      email: null,
      cpf: CPF_DIGITS,
      noCpfReason: null,
      cep: null,
      street: null,
      number: null,
      complement: null,
      district: null,
      city: null,
      state: null,
      insuranceId: null,
      insuranceCard: null,
      guardianName: null,
      guardianRelationship: null,
      guardianPhone: null,
      guardianCpf: null,
      adminNotes: null,
      professionalIds: [],
    });
  });

  it("o id só aparece na edição e precisa ser um identificador válido", () => {
    expect(ok({ id: GUID }).id).toBe(GUID);
    expect(errors({ id: "abc" }).id).toBe("Registro inválido.");
  });
});

describe("nome", () => {
  it("apara e junta espaços", () => {
    expect(ok({ fullName: "  Maria   da  Silva " }).fullName).toBe("Maria da Silva");
  });
  it("é obrigatório e tem limite", () => {
    expect(errors({ fullName: "  " }).fullName).toBe("Informe o nome.");
    expect(errors({ fullName: "a".repeat(121) }).fullName).toMatch(/até 120/);
  });
  it("recusa caractere de controle (o banco recusaria no meio da gravação)", () => {
    expect(errors({ fullName: "Maria\u0007Silva" }).fullName).toBe("O nome contém caracteres inválidos.");
    expect(errors({ fullName: "Maria\u0000Silva" }).fullName).toBe("O nome contém caracteres inválidos.");
    expect(errors({ fullName: "Maria\u001bSilva" }).fullName).toBe("O nome contém caracteres inválidos.");
  });
  it("recusa também os controles C1 (U+0080 a U+009F, como o NEL), que o JavaScript não apara", () => {
    expect(errors({ fullName: "Maria\u0085" }).fullName).toBe("O nome contém caracteres inválidos.");
    expect(errors({ street: "Rua\u0090X" }).street).toBe("Há caracteres inválidos neste campo.");
  });
});

describe("data de nascimento", () => {
  it("aceita hoje e 1º/01/1900", () => {
    expect(errors({ birthDate: TODAY, guardianName: "Ana", guardianRelationship: "Mãe", guardianPhone: "11912345678" })).toEqual({});
    expect(errors({ birthDate: "1900-01-01" })).toEqual({});
  });
  it("recusa vazia, em outro formato, inexistente, futura e anterior a 1900", () => {
    expect(errors({ birthDate: "" }).birthDate).toBe("Informe a data de nascimento.");
    expect(errors({ birthDate: "10/05/1990" }).birthDate).toBe("Data de nascimento inválida.");
    expect(errors({ birthDate: "2026-02-30" }).birthDate).toBe("Data de nascimento inválida.");
    expect(errors({ birthDate: "2026-11-19" }).birthDate).toBe("A data de nascimento não pode ser no futuro.");
    expect(errors({ birthDate: "1899-12-31" }).birthDate).toBe("A data de nascimento deve ser a partir de 1900.");
  });
});

describe("contato", () => {
  it("normaliza telefone e e-mail", () => {
    const data = ok({ email: "  Maria@Exemplo.com " });
    expect(data.phone).toBe("11912345678");
    expect(data.email).toBe("maria@exemplo.com");
  });
  it("recusa telefone e e-mail inválidos", () => {
    expect(errors({ phone: "123" }).phone).toBe("Informe o telefone com DDD, como (11) 91234-5678.");
    expect(errors({ email: "sem-arroba" }).email).toBe("Informe um e-mail válido.");
  });
  it("exige ao menos um contato (telefone, e-mail ou telefone do responsável)", () => {
    expect(errors({ phone: "", email: "" }).phone).toBe("Informe ao menos um contato: telefone ou e-mail.");
    expect(errors({ phone: "", email: "a@b.co" })).toEqual({});
    expect(
      errors({ phone: "", birthDate: "2015-01-01", guardianName: "Ana", guardianRelationship: "Mãe", guardianPhone: "(11) 98888-7777" }),
    ).toEqual({});
  });
});

describe("CPF e 'Sem CPF'", () => {
  it("aceita com ou sem pontuação e guarda só os dígitos", () => {
    expect(ok({ cpf: CPF }).cpf).toBe(CPF_DIGITS);
    expect(ok({ cpf: CPF_DIGITS }).cpf).toBe(CPF_DIGITS);
  });
  it("é obrigatório e precisa ser válido", () => {
    expect(errors({ cpf: "" }).cpf).toBe("Informe o CPF ou marque “Sem CPF”.");
    expect(errors({ cpf: "529.982.247-24" }).cpf).toBe("CPF inválido.");
    expect(errors({ cpf: "111.111.111-11" }).cpf).toBe("CPF inválido.");
  });
  it("a mensagem de erro nunca repete o CPF digitado", () => {
    const result = parse({ cpf: "529.982.247-24" });
    expect(result.success).toBe(false);
    const text = JSON.stringify(result.error?.issues);
    expect(text).not.toContain("52998224724");
    expect(text).not.toContain("529.982.247-24");
  });
  it("'Sem CPF' exige o motivo e deixa o CPF null", () => {
    const data = ok({ noCpf: "on", cpf: "", noCpfReason: "  Estrangeiro, sem CPF  " });
    expect(data.cpf).toBeNull();
    expect(data.noCpfReason).toBe("Estrangeiro, sem CPF");
  });
  it("'Sem CPF' sem motivo (ou só espaços) é recusado", () => {
    expect(errors({ noCpf: "on", cpf: "", noCpfReason: "" }).noCpfReason).toBe("Informe o motivo de não ter CPF.");
    expect(errors({ noCpf: "on", cpf: "", noCpfReason: "   " }).noCpfReason).toBe("Informe o motivo de não ter CPF.");
  });
  it("'Sem CPF' com CPF digitado é recusado (ou um ou outro)", () => {
    expect(errors({ noCpf: "on", cpf: CPF, noCpfReason: "Estrangeiro" }).cpf).toBe(
      "Apague o CPF ou desmarque “Sem CPF”.",
    );
  });
  it("com CPF informado, um motivo esquecido no formulário é descartado", () => {
    const data = ok({ cpf: CPF, noCpfReason: "texto antigo" });
    expect(data.noCpfReason).toBeNull();
  });
  it("o motivo tem limite e não aceita caractere de controle", () => {
    expect(errors({ noCpf: "on", cpf: "", noCpfReason: "a".repeat(201) }).noCpfReason).toMatch(/até 200/);
    expect(errors({ noCpf: "on", cpf: "", noCpfReason: "ruim\u0000" }).noCpfReason).toBe(
      "O motivo contém caracteres inválidos.",
    );
  });
});

describe("endereço", () => {
  it("normaliza CEP e UF", () => {
    const data = ok({ cep: "01310-100", state: "sp", street: " Rua Teste ", city: "São Paulo" });
    expect(data.cep).toBe("01310100");
    expect(data.state).toBe("SP");
    expect(data.street).toBe("Rua Teste");
    expect(data.city).toBe("São Paulo");
  });
  it("recusa CEP e UF inválidos", () => {
    expect(errors({ cep: "123" }).cep).toBe("Informe o CEP com 8 dígitos.");
    expect(errors({ cep: "0131010a" }).cep).toBe("Informe o CEP com 8 dígitos.");
    expect(errors({ state: "XX" }).state).toBe("Escolha um estado válido.");
  });
  it("tem limites de tamanho", () => {
    expect(errors({ street: "a".repeat(121) }).street).toMatch(/até 120/);
    expect(errors({ number: "1".repeat(21) }).number).toMatch(/até 20/);
    expect(errors({ city: "a".repeat(61) }).city).toMatch(/até 60/);
  });
});

describe("convênio", () => {
  it("convênio vazio = particular; carteirinha exige convênio", () => {
    expect(ok({ insuranceId: GUID, insuranceCard: " 123 456 " })).toMatchObject({
      insuranceId: GUID,
      insuranceCard: "123 456",
    });
    expect(errors({ insuranceCard: "123" }).insuranceCard).toBe("Escolha o convênio da carteirinha.");
  });
  it("recusa convênio inválido e carteirinha longa", () => {
    expect(errors({ insuranceId: "abc" }).insuranceId).toBe("Convênio inválido.");
    expect(errors({ insuranceId: GUID, insuranceCard: "1".repeat(41) }).insuranceCard).toMatch(/até 40/);
  });
});

describe("responsável legal", () => {
  const guardian = {
    guardianName: "Ana Responsável Teste",
    guardianRelationship: "Mãe",
    guardianPhone: "(11) 98888-7777",
  };

  it("menor de 18 anos exige nome, parentesco e telefone do responsável", () => {
    const e = errors({ birthDate: "2015-01-01" });
    expect(e.guardianName).toBe("Informe o nome do responsável (paciente menor de 18 anos).");
    expect(e.guardianRelationship).toBe("Informe o parentesco do responsável.");
    expect(e.guardianPhone).toBe("Informe o telefone do responsável.");
  });
  it("menor com responsável completo passa; CPF do responsável é opcional", () => {
    const data = ok({ birthDate: "2015-01-01", ...guardian });
    expect(data).toMatchObject({
      guardianName: "Ana Responsável Teste",
      guardianRelationship: "Mãe",
      guardianPhone: "11988887777",
      guardianCpf: null,
    });
    expect(ok({ birthDate: "2015-01-01", ...guardian, guardianCpf: OTHER_CPF }).guardianCpf).toBe("11144477735");
  });
  it("quem faz 18 anos hoje já não precisa de responsável", () => {
    expect(errors({ birthDate: "2008-11-18" })).toEqual({});
    expect(errors({ birthDate: "2008-11-19" }).guardianName).toBeDefined();
  });
  it("adulto sem responsável: tudo null", () => {
    expect(ok()).toMatchObject({ guardianName: null, guardianRelationship: null, guardianPhone: null, guardianCpf: null });
  });
  it("adulto que preenche parte do responsável precisa completar nome e parentesco", () => {
    const e = errors({ guardianPhone: "(11) 98888-7777" });
    expect(e.guardianName).toBe("Informe o nome do responsável.");
    expect(e.guardianRelationship).toBe("Informe o parentesco do responsável.");
  });
  it("recusa CPF, telefone e tamanhos inválidos do responsável", () => {
    expect(errors({ ...guardian, guardianCpf: "529.982.247-24" }).guardianCpf).toBe("CPF do responsável inválido.");
    expect(errors({ ...guardian, guardianPhone: "99" }).guardianPhone).toBe(
      "Informe o telefone com DDD, como (11) 91234-5678.",
    );
    expect(errors({ ...guardian, guardianName: "a".repeat(121) }).guardianName).toMatch(/até 120/);
    expect(errors({ ...guardian, guardianRelationship: "a".repeat(41) }).guardianRelationship).toMatch(/até 40/);
  });
});

describe("observações administrativas", () => {
  it("mantém quebras de linha e apara as pontas", () => {
    expect(ok({ adminNotes: "  linha 1\nlinha 2  " }).adminNotes).toBe("linha 1\nlinha 2");
  });
  it("recusa caractere de controle (menos quebra de linha e tab) e texto longo", () => {
    expect(errors({ adminNotes: "ruim\u0000" }).adminNotes).toBe("As observações contêm caracteres inválidos.");
    expect(errors({ adminNotes: "a".repeat(1001) }).adminNotes).toMatch(/até 1000/);
    expect(errors({ adminNotes: "ok\ttab" })).toEqual({});
  });
});

describe("identificadores", () => {
  const UPPER = GUID.toUpperCase();
  it("normalizam para minúsculas (maiúscula e minúscula são o mesmo UUID, inclusive na trava e nos vínculos)", () => {
    const data = ok({ id: UPPER, insuranceId: UPPER, insuranceCard: "1", professionalIds: [UPPER, GUID] });
    expect(data.id).toBe(GUID);
    expect(data.insuranceId).toBe(GUID);
    expect(data.professionalIds).toEqual([GUID]); // o mesmo UUID em duas grafias vira um só
  });
});

describe("profissionais vinculados", () => {
  it("remove repetidos", () => {
    expect(ok({ professionalIds: [GUID, GUID] }).professionalIds).toEqual([GUID]);
  });
  it("recusa identificador inválido e excesso", () => {
    expect(errors({ professionalIds: ["x"] }).professionalIds).toBe("Profissional inválido.");
    const many = Array.from({ length: MAX_PROFESSIONALS + 1 }, (_, i) =>
      `3f2b1c4d-5e6f-4a7b-8c9d-${String(i).padStart(12, "0")}`,
    );
    expect(errors({ professionalIds: many }).professionalIds).toBe("Profissionais demais selecionados.");
  });
});
