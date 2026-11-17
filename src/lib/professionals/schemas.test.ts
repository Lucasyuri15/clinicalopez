import { describe, expect, it } from "vitest";

import { MAX_SERVICES, professionalInputSchema } from "./schemas";

const ID = "6f1c1b5e-8a3f-4a0e-9d57-2f6c5f0b7a11";
const S1 = "0b9f3b2c-5d7e-4f10-8a6b-3c2d1e0f9a88";
const S2 = "9c2d4e6f-1a3b-4c5d-8e7f-0a1b2c3d4e5f";

const base = (over: Record<string, unknown> = {}) => ({
  fullName: "Dra. Maria Ficticia",
  specialty: "physiotherapy",
  registration: "",
  phone: "",
  email: "",
  profileId: "",
  serviceIds: [] as string[],
  ...over,
});

const messageOf = (input: unknown) => {
  const result = professionalInputSchema.safeParse(input);
  return result.success ? null : result.error.issues[0]?.message;
};

describe("professionalInputSchema", () => {
  it("campos opcionais vazios viram null", () => {
    expect(professionalInputSchema.parse(base())).toEqual({
      fullName: "Dra. Maria Ficticia",
      specialty: "physiotherapy",
      registration: null,
      phone: null,
      email: null,
      profileId: null,
      serviceIds: [],
    });
  });

  it("normaliza nome (espaços e NFC), registro, telefone e e-mail", () => {
    const parsed = professionalInputSchema.parse(
      base({
        id: ID,
        fullName: "  João   Ficticio ", // a + til combinante
        registration: "  12345-F  ",
        phone: "+55 (11) 91234-5678",
        email: "  Maria@Clinica.Teste ",
        profileId: S1,
        serviceIds: [S1, S2],
      }),
    );
    expect(parsed).toEqual({
      id: ID,
      fullName: "João Ficticio",
      specialty: "physiotherapy",
      registration: "12345-F",
      phone: "11912345678",
      email: "maria@clinica.teste",
      profileId: S1,
      serviceIds: [S1, S2],
    });
  });

  it("remove serviços repetidos, mantendo a ordem", () => {
    expect(professionalInputSchema.parse(base({ serviceIds: [S1, S2, S1] })).serviceIds).toEqual([S1, S2]);
  });

  it("aceita no máximo MAX_SERVICES serviços", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(professionalInputSchema.safeParse(base({ serviceIds: many(MAX_SERVICES) })).success).toBe(true);
    expect(professionalInputSchema.safeParse(base({ serviceIds: many(MAX_SERVICES + 1) })).success).toBe(false);
  });

  it.each([
    ["nome vazio", { fullName: "  " }, "Informe o nome."],
    ["nome grande demais", { fullName: "a".repeat(121) }, "O nome pode ter até 120 caracteres."],
    ["especialidade inválida", { specialty: "cardiology" }, "Escolha a especialidade."],
    ["registro curto", { registration: "12" }, "O registro deve ter de 3 a 30 caracteres."],
    ["registro longo", { registration: "1".repeat(31) }, "O registro deve ter de 3 a 30 caracteres."],
    ["telefone inválido", { phone: "123" }, "Informe o telefone com DDD, como (11) 91234-5678."],
    ["e-mail inválido", { email: "maria@" }, "Informe um e-mail válido."],
    ["e-mail enorme", { email: `${"a".repeat(250)}@x.com` }, "Informe um e-mail válido."],
    ["id inválido", { id: "123" }, "Registro inválido."],
    ["perfil de login inválido", { profileId: "x" }, "Login inválido."],
    ["serviço inválido na lista", { serviceIds: [S1, "x"] }, "Serviço inválido."],
  ])("recusa %s", (_label, over, message) => {
    expect(messageOf(base(over))).toBe(message);
  });

  it("aceita o registro com 3 e com 30 caracteres", () => {
    expect(professionalInputSchema.safeParse(base({ registration: "123" })).success).toBe(true);
    expect(professionalInputSchema.safeParse(base({ registration: "1".repeat(30) })).success).toBe(true);
  });

  it("campos ausentes não estouram (formulário vazio)", () => {
    expect(professionalInputSchema.safeParse({}).success).toBe(false);
  });
});
