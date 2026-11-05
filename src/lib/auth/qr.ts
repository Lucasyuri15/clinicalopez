/**
 * Normaliza o QR Code do Supabase (`data:image/svg+xml;utf-8,<svg…>`) para uma URL
 * de dados bem formada: o original vem sem codificação e com quebra de linha no final
 * (o `next/image` recusa), e só aceitamos imagem SVG em data URI (nada de outros
 * esquemas). Usada num <img>, o SVG não executa scripts.
 */
export function toSvgDataUri(raw: string): string | null {
  const prefix = /^data:image\/svg\+xml[^,]*,/i.exec(raw);
  if (!prefix) return null;
  const svg = raw.slice(prefix[0].length).trim();
  if (!svg) return null;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
