import type { AttachmentType } from "./files";

/** `%` + hex também para os caracteres que o `encodeURIComponent` deixa passar e o RFC 5987 não aceita. */
const encodeRfc5987 = (value: string) =>
  encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Cabeçalhos da entrega de um anexo. O tipo vem do banco (decidido pelos bytes no envio), o navegador
 * nunca adivinha (`nosniff`), nada fica em cache e o arquivo só serve à nossa origem. PDF baixa;
 * imagem abre na aba (a CSP não muda: é uma navegação, não uma imagem embutida). O nome é texto
 * sensível e entra só no `Content-Disposition`, codificado (sem aspas, barras nem quebras de linha).
 */
export function downloadHeaders(file: { contentType: AttachmentType; name: string; size: number }): Record<string, string> {
  const ascii = file.name.replace(/[^A-Za-z0-9._ -]/g, "_");
  const disposition = file.contentType === "application/pdf" ? "attachment" : "inline";
  return {
    "Content-Type": file.contentType,
    "Content-Length": String(file.size),
    "Content-Disposition": `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(file.name)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
