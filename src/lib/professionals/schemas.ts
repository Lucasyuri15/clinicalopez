import { z } from "zod";

import { SPECIALTIES } from "@/lib/catalog/labels";
import { ID_MESSAGE, nameSchema } from "@/lib/catalog/schemas";
import { normalizePhone } from "@/lib/phone";

/**
 * Validação (Zod) do cadastro de profissionais. Recebe o que vem do formulário (tudo texto) e
 * devolve tipos prontos: campos opcionais vazios viram `null`. Os limites espelham os `CHECK`
 * do banco (migração da 1B-2a): aqui a mensagem é em pt-BR, o banco é a última barreira.
 */
export const REGISTRATION_MIN = 3;
export const REGISTRATION_MAX = 30;
export const EMAIL_MAX = 254;
/** Mais serviços do que existem na clínica toda: teto de sanidade contra entrada gigante. */
export const MAX_SERVICES = 50;

/** Contagem por caractere (o banco conta assim), não por unidade UTF-16. */
const length = (text: string) => [...text].length;

const registration = z.string().transform((value, ctx) => {
  const text = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (text === "") return null;
  if (length(text) < REGISTRATION_MIN || length(text) > REGISTRATION_MAX) {
    ctx.addIssue({
      code: "custom",
      message: `O registro deve ter de ${REGISTRATION_MIN} a ${REGISTRATION_MAX} caracteres.`,
    });
    return z.NEVER;
  }
  return text;
});

const phone = z.string().transform((value, ctx) => {
  if (value.trim() === "") return null;
  const digits = normalizePhone(value);
  if (digits === null) {
    ctx.addIssue({
      code: "custom",
      message: "Informe o telefone com DDD, como (11) 91234-5678.",
    });
    return z.NEVER;
  }
  return digits;
});

const email = z.string().transform((value, ctx) => {
  const text = value.trim().toLowerCase();
  if (text === "") return null;
  if (text.length > EMAIL_MAX || !z.email().safeParse(text).success) {
    ctx.addIssue({ code: "custom", message: "Informe um e-mail válido." });
    return z.NEVER;
  }
  return text;
});

const profileId = z
  .string()
  .transform((value) => (value === "" ? null : value))
  .pipe(z.guid({ error: "Login inválido." }).nullable());

const serviceIds = z
  .array(z.guid({ error: "Serviço inválido." }))
  .transform((ids) => [...new Set(ids)])
  .pipe(z.array(z.string()).max(MAX_SERVICES, { error: "Serviços demais selecionados." }));

export const professionalInputSchema = z.object({
  /** Só na edição. */
  id: z.guid({ error: ID_MESSAGE }).optional(),
  fullName: nameSchema,
  specialty: z.enum(SPECIALTIES, { error: "Escolha a especialidade." }),
  registration,
  phone,
  email,
  /** Perfil de login a vincular (papel `professional`, ainda livre); vazio = sem login. */
  profileId,
  serviceIds,
});

export type ProfessionalInput = z.infer<typeof professionalInputSchema>;
