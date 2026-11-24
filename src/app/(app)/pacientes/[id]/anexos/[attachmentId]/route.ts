import { downloadHeaders } from "@/lib/attachments/download";
import { requireRole } from "@/server/auth/session";
import { openAttachmentForRequest } from "@/server/clinical/attachment-open";

/**
 * Abrir um anexo clínico (Fase 4B-1). Só admin e profissional (`requireRole`: a recepção é mandada de
 * volta ao painel). Quem decide é `openAttachment`: a RLS (autor ou admin), o paciente da URL, o log de
 * acesso gravado ANTES de entregar e o arquivo só depois. O navegador nunca recebe link do Storage:
 * os bytes passam por aqui. Anexo inexistente, de outro paciente ou que a pessoa não enxerga é 404
 * igual. DADO CLÍNICO SENSÍVEL: nada daqui é logado, nem o nome do arquivo.
 */
const NO_STORE = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
  const user = await requireRole("admin", "professional");
  const { id, attachmentId } = await params;
  const result = await openAttachmentForRequest({ userId: user.userId, role: user.role }, { patientId: id, attachmentId });
  if (!result.ok) {
    return result.reason === "not-found"
      ? new Response("Anexo não encontrado.", { status: 404, headers: NO_STORE })
      : new Response("Arquivo indisponível no momento. Tente de novo.", { status: 503, headers: NO_STORE });
  }
  const { bytes, contentType, name } = result.file;
  return new Response(bytes as unknown as BodyInit, { status: 200, headers: downloadHeaders({ contentType, name, size: bytes.length }) });
}
