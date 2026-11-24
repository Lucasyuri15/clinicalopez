/**
 * Regras puras do arquivo anexado (Fase 4B): qual é o tipo REAL (pelos primeiros bytes), se cabe no
 * limite e que nome mostrar. O que o navegador diz (tipo, extensão) nunca decide nada: um `.exe`
 * renomeado para `.pdf` é recusado aqui. SVG e HTML ficam de fora de propósito (executam script).
 *
 * O NOME do arquivo é texto sensível (pode dizer o exame): só aparece para quem pode ler o anexo.
 */
export const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
export const ATTACHMENT_NAME_MAX = 120;

export const ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

const EXTENSION: Record<AttachmentType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((value, index) => bytes[offset + index] === value);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** Tipo pelos primeiros bytes (a assinatura só vale no começo do arquivo), ou `null` se não for permitido. */
export function sniffContentType(bytes: Uint8Array): AttachmentType | null {
  if (startsWith(bytes, ascii("%PDF-"))) return "application/pdf";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

export type FileCheck =
  | { ok: true; contentType: AttachmentType }
  | { ok: false; reason: "empty" | "too-large" | "bad-type" };

/** Vazio, grande demais (o tamanho é conferido antes do tipo) ou tipo não permitido. */
export function validateFile(bytes: Uint8Array): FileCheck {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > ATTACHMENT_MAX_BYTES) return { ok: false, reason: "too-large" };
  const contentType = sniffContentType(bytes);
  return contentType === null ? { ok: false, reason: "bad-type" } : { ok: true, contentType };
}

/** Controle e invisíveis/direção do texto (categoria Cf: largura zero, override bidi...). */
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\p{Cf}]/gu;

/**
 * Nome para exibir: sem caminho, sem caracteres invisíveis ou de direção, NFC, espaços unidos, no
 * máximo 120 pontos de código e **sempre** terminando na extensão do tipo REAL (a extensão que o nome
 * traz, quando parece uma extensão, é trocada). Nunca devolve vazio.
 */
export function displayName(raw: string, contentType: AttachmentType): string {
  const ext = EXTENSION[contentType];
  const lastSegment = raw.normalize("NFC").split(/[\\/]/).pop() ?? "";
  let name = lastSegment
    .replace(/\s/g, " ")
    .replace(HIDDEN, "")
    .replace(/ {2,}/g, " ")
    .trim();
  if (/^[.\s]*$/.test(name)) name = "";

  // Parece extensão: 1 a 4 letras/números com ao menos uma letra (".11" de "laudo 2031.11" não é).
  const dot = name.lastIndexOf(".");
  const tail = dot >= 0 ? name.slice(dot + 1) : "";
  let base = dot >= 0 && /^[A-Za-z0-9]{1,4}$/.test(tail) && /[A-Za-z]/.test(tail) ? name.slice(0, dot) : name;
  base = base.trim().replace(/\.+$/, "").trim();
  if (base === "") base = "arquivo";

  const room = ATTACHMENT_NAME_MAX - (ext.length + 1);
  return `${[...base].slice(0, room).join("").trim()}.${ext}`;
}
