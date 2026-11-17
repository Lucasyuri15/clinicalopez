import { z } from "zod";

import { parseBRLToCents } from "@/lib/money";

import { SPECIALTIES } from "./labels";

/**
 * Validação (Zod) das entradas de serviços, convênios e valores. Recebem o que vem do
 * formulário (tudo texto) e devolvem tipos prontos. Os limites espelham os `CHECK` do banco
 * (migração 0006): a validação aqui dá mensagem em pt-BR, a do banco é a última barreira.
 */
export const NAME_MAX = 120;
export const DURATION_MIN = 5;
export const DURATION_MAX = 480;
/** R$ 100.000,00 por atendimento: teto de sanidade (evita erro de digitação, não regra de negócio). */
export const PRICE_MAX_CENTS = 10_000_000;

const ID_MESSAGE = "Registro inválido.";

// NFC: "ã" digitado e "ã" colado decomposto (a + til) são o mesmo nome para o usuário, mas
// seriam textos diferentes para o índice único do banco.
const name = z
  .string()
  .normalize("NFC")
  .trim()
  .transform((value) => value.replace(/\s+/g, " "))
  .pipe(
    z
      .string()
      .min(1, { error: "Informe o nome." })
      .max(NAME_MAX, { error: `O nome pode ter até ${NAME_MAX} caracteres.` }),
  );

export const serviceInputSchema = z.object({
  /** Só na edição. */
  id: z.guid({ error: ID_MESSAGE }).optional(),
  name,
  specialty: z.enum(SPECIALTIES, { error: "Escolha a especialidade." }),
  durationMinutes: z
    .string()
    .regex(/^\d+$/, { error: "Informe a duração em minutos (número inteiro)." })
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(DURATION_MIN, { error: `A duração mínima é de ${DURATION_MIN} minutos.` })
        .max(DURATION_MAX, { error: `A duração máxima é de ${DURATION_MAX} minutos.` }),
    ),
});

export type ServiceInput = z.infer<typeof serviceInputSchema>;

export const insuranceInputSchema = z.object({
  /** Só na edição. */
  id: z.guid({ error: ID_MESSAGE }).optional(),
  name,
});

export type InsuranceInput = z.infer<typeof insuranceInputSchema>;

/** `insuranceId` vazio = valor particular. */
export const priceInputSchema = z
  .object({
    serviceId: z.guid({ error: "Serviço inválido." }),
    insuranceId: z
      .string()
      .transform((value) => (value === "" ? null : value))
      .pipe(z.guid({ error: "Convênio inválido." }).nullable()),
    price: z.string().transform((value, ctx) => {
      const cents = parseBRLToCents(value);
      if (cents === null || cents > PRICE_MAX_CENTS) {
        ctx.addIssue({ code: "custom", message: "Informe um valor válido, como 150,00." });
        return z.NEVER;
      }
      return cents;
    }),
  })
  .transform(({ price, ...rest }) => ({ ...rest, priceCents: price }));

export type PriceInput = z.infer<typeof priceInputSchema>;
