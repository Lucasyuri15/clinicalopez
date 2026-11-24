import { fitWithin } from "./format";

/** Foto acima disto é reduzida no navegador antes de enviar (o limite do servidor é 4 MiB). */
export const RESIZE_ABOVE_BYTES = 1.5 * 1024 * 1024;
const MAX_SIDE = 2000;

/**
 * SÓ NO NAVEGADOR: reduz uma foto grande do celular (lado maior até 2000 px, JPEG) para caber no
 * limite. Devolve o próprio arquivo se não for JPEG/PNG/WebP, se já for pequeno ou se qualquer passo
 * falhar (o servidor ainda confere tamanho e tipo pelos bytes).
 */
export async function downscaleImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= RESIZE_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^./\\]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
