import { AddendumSheet } from "@/components/clinical/addendum-sheet";
import { FinalizeNoteButton } from "@/components/clinical/finalize-button";
import { NoteSheet } from "@/components/clinical/note-sheet";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateBR, formatDateTimeBR } from "@/lib/datetime";
import type { NoteView, PendingView } from "@/server/clinical/queries";

type Props = {
  /** Só admin e profissional chegam aqui (a recepção nem consulta o prontuário). */
  role: "admin" | "professional";
  patientName: string;
  notes: NoteView[];
  /** Atendimentos Realizados do profissional sem evolução (sempre vazio para o admin). */
  pending: PendingView[];
};

const labelOf = (startsAt: Date, serviceName: string) => `${formatDateTimeBR(startsAt)} · ${serviceName}`;

/**
 * Prontuário do paciente na ficha (Fase 4A): o histórico em ordem cronológica inversa. O profissional
 * escreve, finaliza e adenda só o que é dele; o admin só LÊ (cada leitura fica registrada). O texto é
 * clínico e sensível: nunca vai a URL, log ou erro. A tela só decide botões; a barreira é a ação, o
 * gatilho e a RLS.
 */
export function RecordSection({ role, patientName, notes, pending }: Props) {
  const writes = role === "professional";
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium">Prontuário</h2>
          <p className="text-sm text-muted-foreground">
            {writes
              ? "Só você e o administrador leem as evoluções que você escreve. Cada acesso fica registrado."
              : "Somente leitura: cada evolução é do profissional que a escreveu. Cada acesso fica registrado."}
          </p>
        </div>

        {writes && pending.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label={`Atendimentos de ${patientName} sem evolução`}>
            {pending.map((item) => (
              <li key={item.appointmentId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {labelOf(item.startsAt, item.serviceName)} <span className="text-muted-foreground">· sem evolução</span>
                </span>
                <NoteSheet appointmentId={item.appointmentId} label={labelOf(item.startsAt, item.serviceName)} mode="create" />
              </li>
            ))}
          </ul>
        ) : null}

        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma evolução registrada.</p>
        ) : (
          <ul className="flex flex-col gap-4" aria-label={`Evoluções de ${patientName}`}>
            {notes.map((note) => {
              const label = labelOf(note.startsAt, note.serviceName);
              const draft = note.status === "draft";
              return (
                <li key={note.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{label}</span>
                    {!writes ? <span className="text-muted-foreground">· {note.professionalName}</span> : null}
                    {draft ? (
                      <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">Rascunho</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Finalizada em {formatDateBR(note.finalizedAt ?? note.createdAt)}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words">{note.body}</p>

                  {note.addenda.length > 0 ? (
                    <ul className="flex flex-col gap-2 border-l-2 border-border pl-3" aria-label="Adendos">
                      {note.addenda.map((addendum) => (
                        <li key={addendum.id} className="flex flex-col gap-0.5">
                          <span className="text-xs text-muted-foreground">
                            Adendo de {addendum.authorName || "profissional"} em {formatDateTimeBR(addendum.createdAt)}
                          </span>
                          <p className="whitespace-pre-wrap break-words">{addendum.body}</p>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {writes ? (
                    <div className="flex flex-wrap items-start gap-2">
                      {draft ? (
                        <>
                          <NoteSheet appointmentId={note.appointmentId} label={label} initialBody={note.body} mode="edit" />
                          <FinalizeNoteButton noteId={note.id} label={label} />
                        </>
                      ) : (
                        <AddendumSheet noteId={note.id} label={label} />
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
