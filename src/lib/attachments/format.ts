/** Texto de exibição dos anexos (pt-BR) e a conta de redução de foto. Puro, testado. */

const MIB = 1024 * 1024;

/** "850 KB" ou "1,5 MB" (vírgula decimal). */
export function formatSize(bytes: number): string {
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1).replace(".", ",")} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

const TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "Imagem JPEG",
  "image/png": "Imagem PNG",
  "image/webp": "Imagem WebP",
};

export const typeLabel = (contentType: string): string => TYPE_LABELS[contentType] ?? "Arquivo";

/** Reduz (nunca aumenta) para que o lado maior caiba em `max`, mantendo a proporção e sem lado zero. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
