import { z } from "zod";

import { ID_MESSAGE, NAME_MAX, nameSchema } from "@/lib/catalog/schemas";
import { isRealDate } from "@/lib/datetime";
import { normalizePhone } from "@/lib/phone";
import { EMAIL_MAX } from "@/lib/professionals/schemas";

import { isUnderAge } from "./age";
import { normalizeCpf } from "./cpf";
import { UFS } from "./labels";

/**
 * Validação (Zod) do cadastro de pacientes. Recebe o que vem do formulário (tudo texto) e
 * devolve tipos prontos: campos opcionais vazios viram `null`. Os limites espelham os `CHECK`
 * do banco: aqui a mensagem é em pt-BR, o banco é a última barreira.
 *
 * DADO SENSÍVEL: nenhuma mensagem de erro repete o que foi digitado (CPF, telefone, nome).
 */
export const BIRTH_DATE_MIN = "1900-01-01";
export const NO_CPF_REASON_MAX = 200;
export const MAX_PROFESSIONALS = 20;
export const ADMIN_NOTES_MAX = 1000;
const STREET_MAX = 120;
const NUMBER_MAX = 20;
const SHORT_MAX = 60; // complemento, bairro, cidade
const CARD_MAX = 40;
const RELATIONSHIP_MAX = 40;

const length = (text: string) => [...text].length;

/** Caracteres de controle (byte nulo, bell...) não são texto: o banco recusaria (22021). */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
/** Nas observações valem quebra de linha e tab. */
const CONTROL_EXCEPT_WHITESPACE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

const PHONE_MESSAGE = "Informe o telefone com DDD, como (11) 91234-5678.";

/** UUID em minúsculas: o mesmo UUID em duas grafias seria dois valores para o `Set` e para a trava. */
const lower = (value: string) => value.toLowerCase();

const professionalIds = z
  .array(z.guid({ error: "Profissional inválido." }))
  .transform((ids) => [...new Set(ids.map(lower))])
  .pipe(z.array(z.string()).max(MAX_PROFESSIONALS, { error: "Profissionais demais selecionados." }));

/**
 * Cria o schema com a data de hoje em Brasília (`todayBR()`) injetada: a data de nascimento não
 * pode ser futura e "menor de 18 anos" depende de hoje. Injetar deixa o teste independente do relógio.
 */
export function createPatientInputSchema(today: string) {
  return z
    .object({
      /** Só na edição. */
      id: z
        .guid({ error: ID_MESSAGE })
        .transform(lower)
        .optional(),
      // Caractere de controle: o banco recusaria no meio da gravação (23514/22021).
      fullName: z
        .string()
        .refine((value) => !CONTROL.test(value), { error: "O nome contém caracteres inválidos." })
        .pipe(nameSchema),
      birthDate: z.string(),
      phone: z.string(),
      email: z.string(),
      /** Checkbox: "on" quando marcado. */
      noCpf: z.string().optional(),
      cpf: z.string(),
      noCpfReason: z.string(),
      cep: z.string(),
      street: z.string(),
      number: z.string(),
      complement: z.string(),
      district: z.string(),
      city: z.string(),
      state: z.string(),
      insuranceId: z.string(),
      insuranceCard: z.string(),
      guardianName: z.string(),
      guardianRelationship: z.string(),
      guardianPhone: z.string(),
      guardianCpf: z.string(),
      adminNotes: z.string(),
      professionalIds,
    })
    .transform((v, ctx) => {
      let failed = false;
      const fail = (field: string, message: string) => {
        failed = true;
        ctx.addIssue({ code: "custom", path: [field], message });
      };

      /** Texto curto opcional: NFC, espaços juntados, vazio vira `null`. */
      const text = (field: string, raw: string, max: number, label: string): string | null => {
        if (CONTROL.test(raw)) {
          fail(field, "Há caracteres inválidos neste campo.");
          return null;
        }
        const value = raw.normalize("NFC").trim().replace(/\s+/g, " ");
        if (value === "") return null;
        if (length(value) > max) {
          fail(field, `${label} pode ter até ${max} caracteres.`);
          return null;
        }
        return value;
      };

      const phone = (field: string, raw: string): string | null => {
        if (raw.trim() === "") return null;
        const digits = normalizePhone(raw);
        if (digits === null) fail(field, PHONE_MESSAGE);
        return digits;
      };

      const isEmpty = (raw: string) => raw.trim() === "";

      // --- nascimento ---------------------------------------------------------------------
      const birthDate = v.birthDate.trim();
      let birthOk = false;
      if (birthDate === "") fail("birthDate", "Informe a data de nascimento.");
      else if (!isRealDate(birthDate)) fail("birthDate", "Data de nascimento inválida.");
      else if (birthDate < BIRTH_DATE_MIN) {
        fail("birthDate", "A data de nascimento deve ser a partir de 1900.");
      } else if (birthDate > today) {
        fail("birthDate", "A data de nascimento não pode ser no futuro.");
      } else birthOk = true;

      // --- contato ------------------------------------------------------------------------
      const patientPhone = phone("phone", v.phone);
      let email: string | null = null;
      const emailText = v.email.trim().toLowerCase();
      if (emailText !== "") {
        if (emailText.length > EMAIL_MAX || !z.email().safeParse(emailText).success) {
          fail("email", "Informe um e-mail válido.");
        } else email = emailText;
      }

      // --- CPF ou "Sem CPF" ---------------------------------------------------------------
      const noCpf = v.noCpf === "on";
      let cpf: string | null = null;
      let noCpfReason: string | null = null;
      if (noCpf) {
        if (!isEmpty(v.cpf)) fail("cpf", "Apague o CPF ou desmarque “Sem CPF”.");
        if (CONTROL.test(v.noCpfReason)) {
          fail("noCpfReason", "O motivo contém caracteres inválidos.");
        } else {
          const reason = v.noCpfReason.normalize("NFC").trim().replace(/\s+/g, " ");
          if (reason === "") fail("noCpfReason", "Informe o motivo de não ter CPF.");
          else if (length(reason) > NO_CPF_REASON_MAX) {
            fail("noCpfReason", `O motivo pode ter até ${NO_CPF_REASON_MAX} caracteres.`);
          } else noCpfReason = reason;
        }
      } else if (isEmpty(v.cpf)) {
        fail("cpf", "Informe o CPF ou marque “Sem CPF”.");
      } else {
        cpf = normalizeCpf(v.cpf);
        if (cpf === null) fail("cpf", "CPF inválido.");
      }

      // --- endereço -----------------------------------------------------------------------
      let cep: string | null = null;
      const cepText = v.cep.trim();
      if (cepText !== "") {
        if (/^\d{5}-?\d{3}$/.test(cepText)) cep = cepText.replace("-", "");
        else fail("cep", "Informe o CEP com 8 dígitos.");
      }
      let state: string | null = null;
      const stateText = v.state.trim().toUpperCase();
      if (stateText !== "") {
        if ((UFS as readonly string[]).includes(stateText)) state = stateText;
        else fail("state", "Escolha um estado válido.");
      }
      const street = text("street", v.street, STREET_MAX, "O logradouro");
      const number = text("number", v.number, NUMBER_MAX, "O número");
      const complement = text("complement", v.complement, SHORT_MAX, "O complemento");
      const district = text("district", v.district, SHORT_MAX, "O bairro");
      const city = text("city", v.city, SHORT_MAX, "A cidade");

      // --- convênio -----------------------------------------------------------------------
      let insuranceId: string | null = null;
      const insuranceText = v.insuranceId.trim();
      if (insuranceText !== "") {
        if (z.guid().safeParse(insuranceText).success) insuranceId = lower(insuranceText);
        else fail("insuranceId", "Convênio inválido.");
      }
      const insuranceCard = text("insuranceCard", v.insuranceCard, CARD_MAX, "A carteirinha");
      if (insuranceCard !== null && insuranceText === "") {
        fail("insuranceCard", "Escolha o convênio da carteirinha.");
      }

      // --- responsável legal --------------------------------------------------------------
      const guardianName = text("guardianName", v.guardianName, NAME_MAX, "O nome do responsável");
      const guardianRelationship = text(
        "guardianRelationship",
        v.guardianRelationship,
        RELATIONSHIP_MAX,
        "O parentesco",
      );
      const guardianPhone = phone("guardianPhone", v.guardianPhone);
      let guardianCpf: string | null = null;
      if (!isEmpty(v.guardianCpf)) {
        guardianCpf = normalizeCpf(v.guardianCpf);
        if (guardianCpf === null) fail("guardianCpf", "CPF do responsável inválido.");
      }
      const minor = birthOk && isUnderAge(birthDate, today);
      const anyGuardian = [v.guardianName, v.guardianRelationship, v.guardianPhone, v.guardianCpf].some(
        (raw) => !isEmpty(raw),
      );
      if (minor) {
        if (isEmpty(v.guardianName)) {
          fail("guardianName", "Informe o nome do responsável (paciente menor de 18 anos).");
        }
        if (isEmpty(v.guardianRelationship)) fail("guardianRelationship", "Informe o parentesco do responsável.");
        if (isEmpty(v.guardianPhone)) fail("guardianPhone", "Informe o telefone do responsável.");
      } else if (anyGuardian) {
        if (isEmpty(v.guardianName)) fail("guardianName", "Informe o nome do responsável.");
        if (isEmpty(v.guardianRelationship)) fail("guardianRelationship", "Informe o parentesco do responsável.");
      }

      // --- ao menos um contato ------------------------------------------------------------
      if (patientPhone === null && email === null && guardianPhone === null && isEmpty(v.phone) && isEmpty(v.email)) {
        fail("phone", "Informe ao menos um contato: telefone ou e-mail.");
      }

      // --- observações administrativas ----------------------------------------------------
      let adminNotes: string | null = null;
      if (CONTROL_EXCEPT_WHITESPACE.test(v.adminNotes)) {
        fail("adminNotes", "As observações contêm caracteres inválidos.");
      } else {
        const notes = v.adminNotes.normalize("NFC").replace(/\r\n?/g, "\n").trim();
        if (length(notes) > ADMIN_NOTES_MAX) {
          fail("adminNotes", `As observações podem ter até ${ADMIN_NOTES_MAX} caracteres.`);
        } else if (notes !== "") adminNotes = notes;
      }

      if (failed) return z.NEVER;
      return {
        ...(v.id ? { id: v.id } : {}),
        fullName: v.fullName,
        birthDate,
        phone: patientPhone,
        email,
        cpf,
        noCpfReason,
        cep,
        street,
        number,
        complement,
        district,
        city,
        state,
        insuranceId,
        insuranceCard,
        guardianName,
        guardianRelationship,
        guardianPhone,
        guardianCpf,
        adminNotes,
        professionalIds: v.professionalIds,
      };
    });
}

export type PatientInput = z.output<ReturnType<typeof createPatientInputSchema>>;
