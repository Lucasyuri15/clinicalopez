import { z } from "zod";

import { ID_MESSAGE } from "@/lib/catalog/schemas";
import { addDaysToDate, isRealDate, zonedToUtc } from "@/lib/datetime";

import { parseTime, STEP_MINUTES } from "./time";
import { validateWeek, type WorkRange } from "./week";

/**
 * Validação (Zod) da grade semanal e das folgas/bloqueios. Recebem o que vem do formulário
 * (tudo texto) e devolvem tipos prontos. Os limites espelham os `CHECK` do banco: aqui a
 * mensagem é em pt-BR, o banco é a última barreira.
 */
export const REASON_MAX = 120;
/** Faixa de datas aceita nas folgas (a mesma do CHECK do banco): pega erro de digitação como "0026". */
export const MIN_DATE = "2000-01-01";
export const MAX_DATE = "2100-12-31";
export const MAX_PERIOD_DAYS = 366;
/** A semana cheia tem no máximo 7 × 6 faixas; o JSON do formulário nunca chega perto disso. */
const WEEK_JSON_MAX = 20_000;
const GENERIC_WEEK = "Dados da semana inválidos.";

const rawRange = z.object({ weekday: z.number(), start: z.string(), end: z.string() });

/** `ranges` é o JSON `[{ weekday, start: "08:00", end: "12:00" }]` do editor da semana. */
export const weekInputSchema = z.object({
  professionalId: z.guid({ error: ID_MESSAGE }),
  ranges: z.string().transform((raw, ctx): WorkRange[] => {
    const invalid = (message: string) => {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    };
    if (raw.length > WEEK_JSON_MAX) return invalid(GENERIC_WEEK);
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return invalid(GENERIC_WEEK);
    }
    const parsed = z.array(rawRange).safeParse(data);
    if (!parsed.success) return invalid(GENERIC_WEEK);

    const ranges: WorkRange[] = [];
    for (const item of parsed.data) {
      const start = parseTime(item.start);
      const end = parseTime(item.end);
      if (start === null || end === null) return invalid("Use horários no formato 08:00.");
      ranges.push({ weekday: item.weekday, start, end });
    }
    const result = validateWeek(ranges);
    return result.ok ? result.ranges : invalid(result.error);
  }),
});

export type WeekInput = z.infer<typeof weekInputSchema>;

const reason = z.string().transform((value, ctx) => {
  // Caracteres de controle (byte nulo, bell...) não são texto: o banco recusaria (22021).
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    ctx.addIssue({ code: "custom", message: "O motivo contém caracteres inválidos." });
    return z.NEVER;
  }
  const text = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (text === "") return null;
  if ([...text].length > REASON_MAX) {
    ctx.addIssue({ code: "custom", message: `O motivo pode ter até ${REASON_MAX} caracteres.` });
    return z.NEVER;
  }
  return text;
});

/** Hora de início/fim de um bloqueio parcial: "HH:MM", de 5 em 5 minutos, de 00:00 a 23:55. */
function wallTime(text: string): string | null {
  const minutes = parseTime(text);
  return minutes !== null && minutes < 1440 && minutes % STEP_MINUTES === 0 ? text : null;
}

/**
 * Folga ou bloqueio. Datas e horas são as DIGITADAS em Brasília e viram instantes UTC.
 * - `allDay` ("on" no checkbox): da meia-noite do primeiro dia à meia-noite DEPOIS do último.
 * - Parcial: de `startDate startTime` até `endDate endTime` (pode atravessar dias).
 */
export const timeOffInputSchema = z
  .object({
    professionalId: z.guid({ error: ID_MESSAGE }),
    startDate: z.string(),
    endDate: z.string(),
    allDay: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    reason,
  })
  .transform((value, ctx) => {
    const invalid = (message: string) => {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    };
    if (!isRealDate(value.startDate)) return invalid("Informe a data de início.");
    if (!isRealDate(value.endDate)) return invalid("Informe a data de término.");
    for (const date of [value.startDate, value.endDate]) {
      if (date < MIN_DATE || date > MAX_DATE) return invalid("Informe uma data entre 2000 e 2100.");
    }
    if (value.endDate < value.startDate) return invalid("A data de término não pode ser antes da de início.");

    let startsAt: Date;
    let endsAt: Date;
    if (value.allDay === "on") {
      startsAt = zonedToUtc(value.startDate, "00:00");
      endsAt = zonedToUtc(addDaysToDate(value.endDate, 1), "00:00");
    } else {
      const startTime = wallTime(value.startTime);
      const endTime = wallTime(value.endTime);
      if (startTime === null || endTime === null) {
        return invalid("Informe os horários de início e de fim, de 5 em 5 minutos.");
      }
      startsAt = zonedToUtc(value.startDate, startTime);
      endsAt = zonedToUtc(value.endDate, endTime);
      if (endsAt.getTime() <= startsAt.getTime()) return invalid("O horário de fim deve ser depois do início.");
    }
    if (endsAt.getTime() - startsAt.getTime() > MAX_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
      return invalid(`O período pode ter no máximo ${MAX_PERIOD_DAYS} dias.`);
    }
    return { professionalId: value.professionalId, startsAt, endsAt, reason: value.reason };
  });

export type TimeOffInput = z.infer<typeof timeOffInputSchema>;
