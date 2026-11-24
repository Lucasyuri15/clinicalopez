import { randomUUID } from "node:crypto";

import { type AgendaSeed, at, seedAgenda } from "./appointments-rls-fixture";
import type { Tx } from "./client";
import {
  appointments,
  clinicalAccessLog,
  clinicalNoteAddenda,
  clinicalNotes,
  patientProfessionals,
  patients,
} from "./schema";

/**
 * Cenário dos testes de RLS do prontuário (`clinical-rls.test.ts` e `clinical-rls-write.test.ts`).
 * Só dados FICTÍCIOS; só `*.test.ts` importam. Parte da agenda (`seedAgenda`: profissionais A e B,
 * serviço, pacientes) e acrescenta, pelo dono do banco (que passa pelos gatilhos), um paciente
 * COMPARTILHADO (`pShared`, vinculado a A e a B) para provar que um profissional nunca lê o que o
 * outro escreveu no MESMO paciente:
 *  apA / apB            Realizados (passado) de A e de B com `pShared`
 *  apA2 / apB2          Realizados de A e de B com `pShared` (cada um com um RASCUNHO)
 *  apAFree / apBFree    Realizados de A e de B com `pShared`, SEM evolução (livres para criar nos testes)
 *  apAScheduled         Agendado (futuro) de A com `pShared`: não aceita evolução
 *  apANoShow / apACancelled   Falta e Cancelado de A com `pShared`: não aceitam evolução
 *  noteA / noteB        evoluções FINALIZADAS de A e de B (apA, apB), cada uma com um adendo
 *  draftA / draftB      RASCUNHOS de A e de B (apA2, apB2)
 *  logA                 uma linha de log (leitura de A)
 */
export type ClinicalSeed = AgendaSeed & {
  pShared: string;
  apA: string;
  apB: string;
  apA2: string;
  apB2: string;
  apAFree: string;
  apBFree: string;
  apAScheduled: string;
  apANoShow: string;
  apACancelled: string;
  noteA: string;
  noteB: string;
  draftA: string;
  draftB: string;
  addendumA: string;
  addendumB: string;
  logA: number;
  /** O que o profissional A e o B enxergam de evolução (a deles, nunca a do outro). */
  notesOfA: string[];
  notesOfB: string[];
  allNotes: string[];
};

const PAST = new Date("2026-01-20T00:00:00Z");

export async function seedClinical(
  tx: Tx,
  ids: { admin: string; professional: string; professional2: string },
  label: string,
): Promise<ClinicalSeed> {
  const base = await seedAgenda(tx, ids, label);
  const [shared] = await tx
    .insert(patients)
    .values({ fullName: `[teste] Paciente Compartilhado ${label} ${randomUUID().slice(0, 8)}`, birthDate: "1988-08-08" })
    .returning({ id: patients.id });
  const pShared = shared!.id;
  await tx.insert(patientProfessionals).values([
    { patientId: pShared, professionalId: base.professionalA },
    { patientId: pShared, professionalId: base.professionalB },
  ]);

  const ap = async (
    professionalId: string,
    day: string,
    from: string,
    to: string,
    status: "done" | "scheduled" | "no_show" | "cancelled" = "done",
  ) => {
    const [row] = await tx
      .insert(appointments)
      .values({
        professionalId,
        patientId: pShared,
        serviceId: base.serviceId,
        specialty: "physiotherapy",
        status,
        cancelReason: status === "cancelled" ? "[teste] cancelado" : null,
        startsAt: at(day, from),
        endsAt: at(day, to),
        createdBy: ids.admin,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      })
      .returning({ id: appointments.id });
    return row!.id;
  };
  const apA = await ap(base.professionalA, "2026-01-12", "10:00", "10:50");
  const apB = await ap(base.professionalB, "2026-01-12", "11:00", "11:50");
  const apA2 = await ap(base.professionalA, "2026-01-13", "10:00", "10:50");
  const apB2 = await ap(base.professionalB, "2026-01-13", "11:00", "11:50");
  const apAFree = await ap(base.professionalA, "2026-01-14", "10:00", "10:50");
  const apBFree = await ap(base.professionalB, "2026-01-14", "11:00", "11:50");
  const apANoShow = await ap(base.professionalA, "2026-01-15", "10:00", "10:50", "no_show");
  const apACancelled = await ap(base.professionalA, "2026-01-16", "10:00", "10:50", "cancelled");
  const apAScheduled = await ap(base.professionalA, "2031-10-06", "10:00", "10:50", "scheduled");

  const note = async (
    appointmentId: string,
    professionalId: string,
    authorLogin: string,
    body: string,
    status: "draft" | "finalized",
  ) => {
    const [row] = await tx
      .insert(clinicalNotes)
      .values({
        appointmentId,
        patientId: pShared,
        professionalId,
        body,
        status,
        finalizedAt: status === "finalized" ? PAST : null,
        finalizedBy: status === "finalized" ? authorLogin : null,
        createdAt: PAST,
        updatedAt: PAST,
      })
      .returning({ id: clinicalNotes.id });
    return row!.id;
  };
  const noteA = await note(apA, base.professionalA, ids.professional, "[teste] evolução finalizada de A", "finalized");
  const noteB = await note(apB, base.professionalB, ids.professional2, "[teste] evolução finalizada de B", "finalized");
  const draftA = await note(apA2, base.professionalA, ids.professional, "[teste] rascunho de A", "draft");
  const draftB = await note(apB2, base.professionalB, ids.professional2, "[teste] rascunho de B", "draft");

  const addendum = async (noteId: string, createdBy: string, body: string) => {
    const [row] = await tx
      .insert(clinicalNoteAddenda)
      .values({ noteId, createdBy, body, createdAt: PAST })
      .returning({ id: clinicalNoteAddenda.id });
    return row!.id;
  };
  const addendumA = await addendum(noteA, ids.professional, "[teste] adendo de A");
  const addendumB = await addendum(noteB, ids.professional2, "[teste] adendo de B");

  // O dono não tem `auth.uid()` nem papel: o log semeado informa os dois.
  const [log] = await tx
    .insert(clinicalAccessLog)
    .values({ userId: ids.professional, role: "professional", action: "read_note", patientId: pShared, noteId: noteA })
    .returning({ id: clinicalAccessLog.id });

  return {
    ...base,
    pShared,
    apA,
    apB,
    apA2,
    apB2,
    apAFree,
    apBFree,
    apAScheduled,
    apANoShow,
    apACancelled,
    noteA,
    noteB,
    draftA,
    draftB,
    addendumA,
    addendumB,
    logA: log!.id,
    notesOfA: [noteA, draftA],
    notesOfB: [noteB, draftB],
    allNotes: [noteA, noteB, draftA, draftB],
  };
}
