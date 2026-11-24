import { z } from "zod";

/**
 * Validação (Zod) dos ids que acompanham o arquivo (Fase 4B). O arquivo em si é conferido por
 * `validateFile` (bytes, não texto). Mensagens fixas: nunca repetem o que foi enviado.
 */
const uuidOf = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  return z.guid().safeParse(value).success ? value : null;
};

/** Anexar: paciente (obrigatório) e atendimento Realizado (opcional; vazio vira `null`). */
export function uploadAttachmentSchema() {
  return z
    .object({ patientId: z.string(), appointmentId: z.string().optional() })
    .transform((v, ctx) => {
      const patientId = uuidOf(v.patientId);
      if (patientId === null) ctx.addIssue({ code: "custom", path: ["patientId"], message: "Paciente inválido." });
      const rawAppointment = (v.appointmentId ?? "").trim();
      const appointmentId = rawAppointment === "" ? null : uuidOf(rawAppointment);
      if (rawAppointment !== "" && appointmentId === null) {
        ctx.addIssue({ code: "custom", path: ["appointmentId"], message: "Atendimento inválido." });
      }
      if (patientId === null || (rawAppointment !== "" && appointmentId === null)) return z.NEVER;
      return { patientId, appointmentId };
    });
}

/** Remover: só o id do anexo. */
export function removeAttachmentSchema() {
  return z.object({ attachmentId: z.string() }).transform((v, ctx) => {
    const attachmentId = uuidOf(v.attachmentId);
    if (attachmentId === null) {
      ctx.addIssue({ code: "custom", path: ["attachmentId"], message: "Anexo inválido." });
      return z.NEVER;
    }
    return { attachmentId };
  });
}
