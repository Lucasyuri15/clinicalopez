import { z } from "zod";

import { isRealDate } from "@/lib/datetime";

/**
 * Regras puras do consentimento LGPD do paciente (1B-3b). O histórico é só de inclusão: o
 * estado atual de cada tipo é o evento mais recente. Os limites espelham os `CHECK` do banco;
 * aqui a mensagem é em pt-BR e o banco é a última barreira.
 *
 * DADO SENSÍVEL: a nota é texto livre. Nenhuma mensagem de erro repete o que foi digitado.
 */
export const CONSENT_KINDS = ["data_processing", "whatsapp"] as const;
export const CONSENT_GIVEN_BY = ["patient", "guardian"] as const;
export const CONSENT_METHODS = ["signed_paper", "verbal", "digital"] as const;
export const CONSENT_NOTE_MAX = 300;
export const CONSENT_DATE_MIN = "1900-01-01";

export type ConsentKind = (typeof CONSENT_KINDS)[number];
export type ConsentGivenBy = (typeof CONSENT_GIVEN_BY)[number];
export type ConsentMethod = (typeof CONSENT_METHODS)[number];
export type ConsentStatus = "granted" | "revoked" | "none";

export const CONSENT_KIND_LABELS: Record<ConsentKind, string> = {
  data_processing: "Tratamento de dados",
  whatsapp: "Mensagens por WhatsApp",
};
export const CONSENT_GIVEN_BY_LABELS: Record<ConsentGivenBy, string> = {
  patient: "Paciente",
  guardian: "Responsável legal",
};
export const CONSENT_METHOD_LABELS: Record<ConsentMethod, string> = {
  signed_paper: "Papel assinado",
  verbal: "Verbal",
  digital: "Digital",
};
export const CONSENT_STATUS_LABELS: Record<ConsentStatus, string> = {
  granted: "Concedido",
  revoked: "Revogado",
  none: "Não registrado",
};

/** Um evento do histórico, como a tela o recebe. */
export type ConsentEvent = {
  id: string;
  kind: ConsentKind;
  granted: boolean;
  givenBy: ConsentGivenBy;
  method: ConsentMethod;
  /** Data real do consentimento (`YYYY-MM-DD`); pode ser anterior ao registro. */
  occurredOn: string;
  note: string | null;
  /** Nome de quem registrou, quando o perfil dele é legível. */
  registeredByName: string | null;
  createdAt: Date;
};

const length = (text: string) => [...text].length;

/** Caracteres de controle (byte nulo, bell...) não são texto: o banco recusaria (22021). */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

const oneOf = <T extends string>(options: readonly T[], value: string): value is T =>
  (options as readonly string[]).includes(value);

/**
 * Cria o schema com a data de hoje em Brasília (`todayBR()`) injetada: a data do consentimento
 * não pode ser futura. Injetar deixa o teste independente do relógio. Quem registrou e quando
 * NÃO vêm do formulário: o banco grava `auth.uid()` e `now()`.
 */
export function createConsentInputSchema(today: string) {
  return z
    .object({
      patientId: z.string(),
      kind: z.string(),
      /** "true" (concedeu) ou "false" (revogou): vem de botões de opção. */
      granted: z.string(),
      givenBy: z.string(),
      method: z.string(),
      occurredOn: z.string(),
      note: z.string(),
    })
    .transform((v, ctx) => {
      let failed = false;
      const fail = (field: string, message: string) => {
        failed = true;
        ctx.addIssue({ code: "custom", path: [field], message });
      };

      const patientId = v.patientId.trim().toLowerCase();
      if (!z.guid().safeParse(patientId).success) fail("patientId", "Paciente inválido.");

      const kind = v.kind.trim();
      if (!oneOf(CONSENT_KINDS, kind)) fail("kind", "Escolha o tipo de consentimento.");

      const grantedText = v.granted.trim();
      if (grantedText !== "true" && grantedText !== "false") {
        fail("granted", "Informe se o consentimento foi concedido ou revogado.");
      }

      const givenBy = v.givenBy.trim();
      if (!oneOf(CONSENT_GIVEN_BY, givenBy)) fail("givenBy", "Informe quem deu o consentimento.");

      const method = v.method.trim();
      if (!oneOf(CONSENT_METHODS, method)) fail("method", "Informe como o consentimento foi obtido.");

      const occurredOn = v.occurredOn.trim();
      if (occurredOn === "") fail("occurredOn", "Informe a data do consentimento.");
      else if (!isRealDate(occurredOn)) fail("occurredOn", "Data do consentimento inválida.");
      else if (occurredOn < CONSENT_DATE_MIN) {
        fail("occurredOn", "A data do consentimento deve ser a partir de 1900.");
      } else if (occurredOn > today) {
        fail("occurredOn", "A data do consentimento não pode ser no futuro.");
      }

      let note: string | null = null;
      if (CONTROL.test(v.note.replace(/\s/g, " "))) {
        fail("note", "A nota contém caracteres inválidos.");
      } else {
        const cleaned = v.note.normalize("NFC").trim().replace(/\s+/g, " ");
        if (length(cleaned) > CONSENT_NOTE_MAX) {
          fail("note", `A nota pode ter até ${CONSENT_NOTE_MAX} caracteres.`);
        } else if (cleaned !== "") note = cleaned;
      }

      if (failed) return z.NEVER;
      return {
        patientId,
        kind: kind as ConsentKind,
        granted: grantedText === "true",
        givenBy: givenBy as ConsentGivenBy,
        method: method as ConsentMethod,
        occurredOn,
        note,
      };
    });
}

export type ConsentInput = z.output<ReturnType<typeof createConsentInputSchema>>;

/** Mais recente primeiro: data real do consentimento e, no empate, quem foi registrado por último. */
function isMoreRecent(a: ConsentEvent, b: ConsentEvent): boolean {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn > b.occurredOn;
  return a.createdAt.getTime() > b.createdAt.getTime();
}

/**
 * Estado atual de cada tipo = o evento mais recente dele (ou `null` se nunca registrado).
 * A data real manda: uma revogação verbal de ontem, lançada hoje, vale mais que uma concessão
 * de anteontem; e um registro tardio de um evento antigo não derruba o estado mais recente.
 */
export function currentConsents(events: readonly ConsentEvent[]): Record<ConsentKind, ConsentEvent | null> {
  const current: Record<ConsentKind, ConsentEvent | null> = { data_processing: null, whatsapp: null };
  for (const item of events) {
    const best = current[item.kind];
    if (best === null || isMoreRecent(item, best)) current[item.kind] = item;
  }
  return current;
}

export function consentStatus(event: ConsentEvent | null): ConsentStatus {
  if (event === null) return "none";
  return event.granted ? "granted" : "revoked";
}

/** Selo de aviso: falta o consentimento de tratamento de dados (nunca registrado ou revogado). */
export function lacksDataConsent(current: Record<ConsentKind, ConsentEvent | null>): boolean {
  return consentStatus(current.data_processing) !== "granted";
}
