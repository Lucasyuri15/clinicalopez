"use client";

import { type ChangeEvent, useRef, useState } from "react";

import { FormErrorBox, useFormAction } from "@/components/agenda/form-action";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ATTACHMENT_MAX_BYTES } from "@/lib/attachments/files";
import { downscaleImage } from "@/lib/attachments/resize";
import { uploadAttachmentAction } from "@/server/clinical/attachment-actions";
import { ATTACHMENT_MESSAGES } from "@/server/clinical/messages";

const FIELD =
  "h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9 md:text-sm";

const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,.pdf,.jpg,.jpeg,.png,.webp";

/** Um atendimento Realizado do profissional, já com o rótulo pronto ("06/10/2031 14:00 · Sessão"). */
export type AppointmentOption = { id: string; label: string };

/** Anexar um arquivo ao paciente (com atendimento Realizado opcional). O formulário nasce DENTRO da gaveta. */
export function AttachmentSheet({ patientId, appointments }: { patientId: string; appointments: AppointmentOption[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" className="h-10 md:h-7">
            Anexar arquivo
          </Button>
        }
      />
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Anexar arquivo</SheetTitle>
          <SheetDescription>PDF, JPEG, PNG ou WebP, até 4 MB. Só você e o administrador veem o que você anexa.</SheetDescription>
        </SheetHeader>
        <AttachmentForm patientId={patientId} appointments={appointments} onSaved={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

function AttachmentForm({ patientId, appointments, onSaved }: { patientId: string; appointments: AppointmentOption[]; onSaved: () => void }) {
  const { state, formAction, pending, errorRef } = useFormAction(uploadAttachmentAction, onSaved);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const chosen = input.files?.[0];
    setFileError(null);
    if (!chosen) return;
    setPreparing(true);
    // Foto grande do celular é reduzida aqui; PDF e arquivo pequeno seguem como estão.
    const file = await downscaleImage(chosen);
    setPreparing(false);
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setFileError(ATTACHMENT_MESSAGES["too-large"]);
      input.value = "";
      return;
    }
    if (file !== chosen) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
    }
  }

  const appointmentId = state?.values?.appointmentId ?? "";
  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4" noValidate>
      <input type="hidden" name="patientId" value={patientId} />
      <FormErrorBox state={state} errorRef={errorRef} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="attachment-file" className="text-sm font-medium">
          Arquivo
        </label>
        <input ref={inputRef} id="attachment-file" name="file" type="file" accept={ACCEPT} onChange={onFile} className={FIELD + " py-2 md:py-1.5"} />
        {fileError ? (
          <p role="alert" className="text-sm text-destructive">
            {fileError}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="attachment-appointment" className="text-sm font-medium">
          Atendimento (opcional)
        </label>
        {/* `key` = o que o servidor devolveu: ao chegar um erro, o campo remonta com a escolha feita. */}
        <select key={appointmentId} id="attachment-appointment" name="appointmentId" defaultValue={appointmentId} className={FIELD}>
          <option value="">Nenhum (anexo do paciente)</option>
          {appointments.map((appointment) => (
            <option key={appointment.id} value={appointment.id}>
              {appointment.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" className="h-11 md:h-8" disabled={pending || preparing}>
        {pending ? "Enviando…" : preparing ? "Preparando…" : "Anexar"}
      </Button>
    </form>
  );
}
