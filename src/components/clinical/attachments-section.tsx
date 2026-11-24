import { AttachmentSheet } from "@/components/clinical/attachment-sheet";
import { RemoveAttachmentButton } from "@/components/clinical/remove-attachment-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatSize, typeLabel } from "@/lib/attachments/format";
import { formatDateBR, formatDateTimeBR } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import type { AttachmentView, PendingView } from "@/server/clinical/queries";

type Props = {
  /** Só admin e profissional chegam aqui (a recepção nem consulta). */
  role: "admin" | "professional";
  patientId: string;
  patientName: string;
  attachments: AttachmentView[];
  /** Atendimentos Realizados do profissional (para ligar o anexo a um); vazio para o admin. */
  doneAppointments: PendingView[];
};

/**
 * Anexos clínicos do paciente na ficha (Fase 4B-1). O profissional anexa e remove só o que é dele; o
 * admin só LÊ (cada abertura fica registrada). O arquivo nunca é embutido na página (sem miniatura): o
 * link abre uma rota que confere o acesso e registra a leitura. O nome do arquivo é texto sensível: só
 * aparece aqui, para quem pode ler. A tela só decide botões; a barreira é a ação, o gatilho e a RLS.
 */
export function AttachmentsSection({ role, patientId, patientName, attachments, doneAppointments }: Props) {
  const writes = role === "professional";
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h2 className="font-medium">Anexos</h2>
            <p className="text-sm text-muted-foreground">
              {writes
                ? "Exames, fotos e documentos. Só você e o administrador veem o que você anexa. Cada abertura fica registrada."
                : "Somente leitura: cada anexo é do profissional que o enviou. Cada abertura fica registrada."}
            </p>
          </div>
          {writes ? (
            <AttachmentSheet
              patientId={patientId}
              appointments={doneAppointments.map((item) => ({ id: item.appointmentId, label: `${formatDateTimeBR(item.startsAt)} · ${item.serviceName}` }))}
            />
          ) : null}
        </div>

        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum anexo.</p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={`Anexos de ${patientName}`}>
            {attachments.map((attachment) => {
              const isPdf = attachment.contentType === "application/pdf";
              return (
                <li key={attachment.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium break-words">{attachment.originalName}</span>
                    <span className="text-muted-foreground">
                      {typeLabel(attachment.contentType)} · {formatSize(attachment.sizeBytes)} · enviado em {formatDateBR(attachment.createdAt)}
                      {attachment.appointmentStartsAt ? ` · atendimento de ${formatDateBR(attachment.appointmentStartsAt)}` : ""}
                      {!writes ? ` · ${attachment.professionalName}` : ""}
                      {attachment.removedAt ? ` · Removido em ${formatDateBR(attachment.removedAt)}` : ""}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-start gap-2">
                    <a
                      href={`/pacientes/${patientId}/anexos/${attachment.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${isPdf ? "Baixar" : "Abrir"} ${attachment.originalName}`}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 md:h-7")}
                    >
                      {isPdf ? "Baixar" : "Abrir"}
                    </a>
                    {writes ? <RemoveAttachmentButton attachmentId={attachment.id} name={attachment.originalName} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
