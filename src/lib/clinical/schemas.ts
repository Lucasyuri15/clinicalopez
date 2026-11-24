import { z } from "zod";

/**
 * Validação (Zod) das entradas do prontuário (Fase 4A). Recebe o que vem do formulário (tudo texto)
 * e devolve tipos prontos. O limite espelha o `CHECK` do banco; aqui a mensagem é em pt-BR e o banco
 * é a última barreira.
 *
 * DADO CLÍNICO SENSÍVEL: o texto é livre. Nenhuma mensagem de erro repete o que foi digitado.
 */
export const NOTE_MAX = 20_000;

const length = (text: string) => [...text].length;
/**
 * Caracteres de controle (byte nulo, bell...: o banco recusaria com 22021) e os invisíveis ou de
 * direção do texto (categoria Cf: largura zero, override bidi...), que deixariam uma evolução
 * "vazia" ou embaralhariam o texto na tela. Quebra de linha e tabulação são texto clínico normal e
 * ficam de fora da checagem.
 */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/u;

type Fail = (field: string, message: string) => void;

const uuidOf = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  return z.guid().safeParse(value).success ? value : null;
};

/** Texto livre: NFC, quebras de linha unificadas em `\n`, sem espaço nas pontas, 1 a `NOTE_MAX`. */
function parseBody(raw: string, emptyMessage: string, fail: Fail): string | null {
  const unified = raw.normalize("NFC").replace(/\r\n?/g, "\n");
  if (CONTROL.test(unified.replace(/[\n\t]/g, " "))) {
    fail("body", "O texto contém caracteres invisíveis ou de controle (comuns ao copiar do WhatsApp ou do Word). Remova-os e tente de novo.");
    return null;
  }
  const body = unified.trim();
  if (body === "") {
    fail("body", emptyMessage);
    return null;
  }
  if (length(body) > NOTE_MAX) {
    fail("body", `O texto pode ter até ${NOTE_MAX} caracteres.`);
    return null;
  }
  return body;
}

/** Cria as funções de falha e de conferência do transform; o resultado só vale se nada falhou. */
function collector(ctx: z.RefinementCtx) {
  let failed = false;
  const fail: Fail = (field, message) => {
    failed = true;
    ctx.addIssue({ code: "custom", path: [field], message });
  };
  return { fail, hasFailed: () => failed };
}

/** Salvar a evolução (criar o rascunho no 1º salvamento, ou atualizar o rascunho). */
export function saveNoteSchema() {
  return z.object({ appointmentId: z.string(), body: z.string() }).transform((v, ctx) => {
    const { fail, hasFailed } = collector(ctx);
    const appointmentId = uuidOf(v.appointmentId);
    if (appointmentId === null) fail("appointmentId", "Atendimento inválido.");
    const body = parseBody(v.body, "Escreva a evolução.", fail);
    if (hasFailed() || appointmentId === null || body === null) return z.NEVER;
    return { appointmentId, body };
  });
}

/** Finalizar: só o id da evolução (o texto já está salvo como rascunho). */
export function finalizeNoteSchema() {
  return z.object({ noteId: z.string() }).transform((v, ctx) => {
    const noteId = uuidOf(v.noteId);
    if (noteId === null) {
      ctx.addIssue({ code: "custom", path: ["noteId"], message: "Evolução inválida." });
      return z.NEVER;
    }
    return { noteId };
  });
}

/** Adicionar um adendo a uma evolução finalizada. */
export function addendumSchema() {
  return z.object({ noteId: z.string(), body: z.string() }).transform((v, ctx) => {
    const { fail, hasFailed } = collector(ctx);
    const noteId = uuidOf(v.noteId);
    if (noteId === null) fail("noteId", "Evolução inválida.");
    const body = parseBody(v.body, "Escreva o adendo.", fail);
    if (hasFailed() || noteId === null || body === null) return z.NEVER;
    return { noteId, body };
  });
}
