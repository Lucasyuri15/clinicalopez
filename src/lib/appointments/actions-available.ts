import { CHANGEABLE_STATUSES, type ChangeableStatus } from "./schemas";
import { allowedTransitions, checkStatusChange, isStaffRole, type ActorRole, type AppointmentStatus } from "./status";

export type AvailableActions = {
  /** Status para os quais o papel pode levar o atendimento AGORA (cancelar tem fluxo próprio). */
  statuses: ChangeableStatus[];
  canReschedule: boolean;
  canCancel: boolean;
};

const OPEN: readonly AppointmentStatus[] = ["scheduled", "confirmed"];

/**
 * O que a tela OFERECE a cada papel num atendimento. Só esconde botões: a barreira de verdade é a
 * ação (`requireRole`), o gatilho e a RLS, que repetem estas regras. Sai do mesmo mapa de
 * `status.ts` (nada é recopiado aqui). Remarcar vale para o atendimento em aberto mesmo que o
 * horário antigo já tenha passado (é o NOVO horário que precisa ser futuro).
 */
export function availableActions(input: {
  role: ActorRole;
  status: AppointmentStatus;
  startsAt: Date;
  now: Date;
}): AvailableActions {
  const { role, status, startsAt, now } = input;
  const staff = isStaffRole(role);
  return {
    statuses: CHANGEABLE_STATUSES.filter(
      (target) =>
        allowedTransitions(role, status).includes(target) &&
        checkStatusChange({ role, from: status, to: target, startsAt, now }).ok,
    ),
    canReschedule: staff && OPEN.includes(status),
    canCancel: staff && allowedTransitions(role, status).includes("cancelled"),
  };
}
