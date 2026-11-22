import "server-only";

import { and, asc, eq, gte, lt, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { Specialty } from "@/lib/catalog/labels";
import { isStaffRole, type ActorRole, type AppointmentStatus } from "@/lib/appointments/status";
import { withoutQueryDetails } from "@/server/db/pg-error";
import { appointments, patients, professionals, services } from "@/server/db/schema";
import { withUser } from "@/server/db/with-user";
import { lackingDataConsentIn } from "@/server/patients/consent-queries";

/**
 * Consultas da agenda. Todas passam por `withUser` (RLS de verdade): o admin recebe todos; a recepção,
 * os de profissional não removido; o PROFISSIONAL só os próprios. O código não repete essa regra por
 * papel. O VALOR do atendimento NUNCA sai daqui (fica em `appointment_prices`, só admin e recepção).
 *
 * `patientName` é `null` quando a RLS esconde o paciente (o profissional só lê os vinculados a ele;
 * o paciente removido some para a recepção). O `role` da SESSÃO decide quem é da equipe (admin e
 * recepção: `isStaffRole`, lista explícita) e só ela recebe o aviso de consentimento e o motivo do
 * cancelamento; o profissional nunca os recebe (o motivo é texto livre). O papel é um parâmetro
 * obrigatório e não um booleano: uma tela que esquecesse ou errasse o `staff` vazaria o motivo.
 *
 * DADO SENSÍVEL: nada daqui é logado; a falha do banco sobe sem a consulta e os parâmetros.
 */
export type AppointmentUser = { userId: string };

export type AgendaItem = {
  id: string;
  professionalId: string;
  professionalName: string;
  specialty: Specialty;
  patientId: string;
  patientName: string | null;
  serviceId: string;
  serviceName: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  /** Só para a equipe (staff); `null` para o profissional. */
  cancelReason: string | null;
  /** Só existe para a equipe (staff): falta o consentimento LGPD de tratamento de dados. */
  lacksDataConsent?: boolean;
};

/** Teto de uma consulta (uma semana de uma clínica pequena cabe com folga). */
export const AGENDA_LIMIT = 1000;

const uuid = z.guid();

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw withoutQueryDetails(error);
  }
}

const columns = {
  id: appointments.id,
  professionalId: appointments.professionalId,
  professionalName: professionals.fullName,
  specialty: appointments.specialty,
  patientId: appointments.patientId,
  patientName: patients.fullName,
  serviceId: appointments.serviceId,
  serviceName: services.name,
  startsAt: appointments.startsAt,
  endsAt: appointments.endsAt,
  status: appointments.status,
  cancelReason: appointments.cancelReason,
};

type Row = {
  id: string;
  professionalId: string;
  professionalName: string;
  specialty: Specialty;
  patientId: string;
  patientName: string | null;
  serviceId: string;
  serviceName: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  cancelReason: string | null;
};

const toItem = (row: Row, staff: boolean): AgendaItem => ({
  ...row,
  status: row.status as AppointmentStatus,
  cancelReason: staff ? row.cancelReason : null,
});

/**
 * Atendimentos com INÍCIO na janela `[from, to)` (meio-aberta), por horário. Filtros opcionais por
 * profissional e especialidade. O profissional recebe só os dele pela RLS, qualquer que seja o filtro.
 */
export async function listAppointments(
  user: AppointmentUser,
  options: { from: Date; to: Date; professionalId?: string | null; specialty?: Specialty | null; role: ActorRole },
): Promise<AgendaItem[]> {
  const staff = isStaffRole(options.role);
  const filters: SQL[] = [gte(appointments.startsAt, options.from), lt(appointments.startsAt, options.to)];
  if (options.professionalId) {
    if (!uuid.safeParse(options.professionalId).success) return [];
    filters.push(eq(appointments.professionalId, options.professionalId));
  }
  if (options.specialty) filters.push(eq(appointments.specialty, options.specialty));

  return guarded(() =>
    withUser(user, async (tx) => {
      const rows = await tx
        .select(columns)
        .from(appointments)
        .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
        .innerJoin(services, eq(services.id, appointments.serviceId))
        .leftJoin(patients, eq(patients.id, appointments.patientId))
        .where(and(...filters))
        .orderBy(asc(appointments.startsAt), asc(appointments.id))
        .limit(AGENDA_LIMIT);
      const items = rows.map((row) => toItem(row, staff));
      if (!staff) return items;
      // O aviso de consentimento só vale para a equipe: para o profissional a RLS não devolve linha.
      const lacking = new Set(await lackingDataConsentIn(tx, [...new Set(items.map((item) => item.patientId))]));
      return items.map((item) => ({ ...item, lacksDataConsent: lacking.has(item.patientId) }));
    }),
  );
}

/** Um atendimento por id, ou `null` (não existe, UUID inválido ou fora da RLS de quem pergunta). */
export async function getAppointment(
  user: AppointmentUser,
  id: string,
  options: { role: ActorRole },
): Promise<AgendaItem | null> {
  if (!uuid.safeParse(id).success) return null;
  const staff = isStaffRole(options.role);
  return guarded(() =>
    withUser(user, async (tx) => {
      const [row] = await tx
        .select(columns)
        .from(appointments)
        .innerJoin(professionals, eq(professionals.id, appointments.professionalId))
        .innerJoin(services, eq(services.id, appointments.serviceId))
        .leftJoin(patients, eq(patients.id, appointments.patientId))
        .where(eq(appointments.id, id));
      if (!row) return null;
      const item = toItem(row, staff);
      if (!staff) return item;
      const lacking = await lackingDataConsentIn(tx, [item.patientId]);
      return { ...item, lacksDataConsent: lacking.includes(item.patientId) };
    }),
  );
}
