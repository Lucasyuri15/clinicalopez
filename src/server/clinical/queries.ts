import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { withoutQueryDetails } from "@/server/db/pg-error";
import {
  appointments,
  clinicalNoteAddenda,
  clinicalNotes,
  type ClinicalNoteStatus,
  professionals,
  profiles,
  services,
  type UserRole,
} from "@/server/db/schema";
import { withUser } from "@/server/db/with-user";

import { recordAccess } from "./access-log";

/**
 * Leitura do prontuário de um paciente (Fase 4A), sempre por `withUser` (RLS de verdade): o admin lê
 * todas as evoluções; o profissional, só as que ELE escreveu (pelo autor, nunca pelo vínculo com o
 * paciente). A recepção NÃO lê: a função devolve `null` SEM tocar no banco nem registrar nada.
 *
 * Cada chamada grava o log na MESMA transação: 1 `read_history` e 1 `read_note` por evolução cujo
 * texto é devolvido. Se o log não puder ser gravado, nada é devolvido (falha fechada). DADO CLÍNICO
 * SENSÍVEL: nada daqui é logado e a falha do banco sobe sem a consulta e os parâmetros.
 */
/** Rótulo de apoio quando o serviço do atendimento foi removido e a RLS o esconde do profissional. */
const REMOVED_SERVICE = "Serviço removido";

export type ClinicalUser = { userId: string; role: UserRole };

export type AddendumView = { id: string; body: string; createdAt: Date; authorName: string };

export type NoteView = {
  id: string;
  appointmentId: string;
  startsAt: Date;
  serviceName: string;
  professionalName: string;
  status: ClinicalNoteStatus;
  body: string;
  createdAt: Date;
  finalizedAt: Date | null;
  addenda: AddendumView[];
};

/** Atendimento Realizado do profissional que ainda não tem evolução. */
export type PendingView = { appointmentId: string; startsAt: Date; serviceName: string };

export type PatientRecord = { notes: NoteView[]; pending: PendingView[] };

export async function getPatientRecord(user: ClinicalUser, patientId: string): Promise<PatientRecord | null> {
  if (user.role === "reception") return null;
  try {
    return await withUser(user, async (tx) => {
      const rows = await tx
        .select({
          id: clinicalNotes.id,
          appointmentId: clinicalNotes.appointmentId,
          startsAt: appointments.startsAt,
          serviceName: services.name,
          professionalName: professionals.fullName,
          status: clinicalNotes.status,
          body: clinicalNotes.body,
          createdAt: clinicalNotes.createdAt,
          finalizedAt: clinicalNotes.finalizedAt,
        })
        .from(clinicalNotes)
        .innerJoin(appointments, eq(appointments.id, clinicalNotes.appointmentId))
        // `left`: o profissional não enxerga serviço REMOVIDO (RLS); a evolução dele não pode sumir por isso.
        .leftJoin(services, eq(services.id, appointments.serviceId))
        .innerJoin(professionals, eq(professionals.id, clinicalNotes.professionalId))
        .where(eq(clinicalNotes.patientId, patientId))
        .orderBy(desc(appointments.startsAt), desc(clinicalNotes.createdAt));

      const addenda =
        rows.length === 0
          ? []
          : await tx
              .select({
                id: clinicalNoteAddenda.id,
                noteId: clinicalNoteAddenda.noteId,
                body: clinicalNoteAddenda.body,
                createdAt: clinicalNoteAddenda.createdAt,
                authorName: profiles.fullName,
              })
              .from(clinicalNoteAddenda)
              .leftJoin(profiles, eq(profiles.id, clinicalNoteAddenda.createdBy))
              .where(
                inArray(
                  clinicalNoteAddenda.noteId,
                  rows.map((row) => row.id),
                ),
              )
              .orderBy(asc(clinicalNoteAddenda.createdAt));

      const notes: NoteView[] = rows.map((row) => ({
        ...row,
        serviceName: row.serviceName ?? REMOVED_SERVICE,
        addenda: addenda
          .filter((addendum) => addendum.noteId === row.id)
          .map((addendum) => ({
            id: addendum.id,
            body: addendum.body,
            createdAt: addendum.createdAt,
            authorName: addendum.authorName ?? "",
          })),
      }));

      // Só o profissional tem "pendentes" (o admin só lê): os atendimentos Realizados dele sem evolução.
      const pending: PendingView[] =
        user.role === "professional"
          ? await tx
              .select({ appointmentId: appointments.id, startsAt: appointments.startsAt, serviceName: services.name })
              .from(appointments)
              .leftJoin(services, eq(services.id, appointments.serviceId))
              .leftJoin(clinicalNotes, eq(clinicalNotes.appointmentId, appointments.id))
              .where(and(eq(appointments.patientId, patientId), eq(appointments.status, "done"), isNull(clinicalNotes.id)))
              .orderBy(desc(appointments.startsAt))
              .then((items) => items.map((item) => ({ ...item, serviceName: item.serviceName ?? REMOVED_SERVICE })))
          : [];

      await recordAccess(tx, [
        { action: "read_history", patientId },
        ...notes.map((note) => ({ action: "read_note" as const, patientId, noteId: note.id })),
      ]);
      return { notes, pending };
    });
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}
