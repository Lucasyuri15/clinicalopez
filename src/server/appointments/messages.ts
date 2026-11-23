import type { AppointmentFailure } from "./mutations";

/**
 * Mensagens FIXAS em pt-BR para cada motivo de recusa da agenda (nunca texto do banco nem o que foi
 * digitado). Num módulo comum porque um arquivo `"use server"` só pode exportar funções, e as ações
 * da agenda e as das séries mostram as mesmas mensagens.
 */
export const FAILURE_MESSAGES: Record<AppointmentFailure | "generic", string> = {
  generic: "Não foi possível concluir. Tente novamente.",
  "not-found": "Paciente, profissional ou atendimento não encontrado. Atualize a página e tente de novo.",
  "service-not-offered": "Este profissional não realiza o serviço escolhido.",
  past: "Esse horário já passou.",
  "invalid-slot": "Horário inválido. Use horários de 5 em 5 minutos, dentro de um mesmo dia.",
  "outside-grid": "Esse horário está fora do atendimento do profissional.",
  "time-off": "O profissional tem uma folga ou bloqueio nesse horário.",
  "conflict-professional": "O profissional já tem um atendimento nesse horário.",
  "conflict-patient": "O paciente já tem um atendimento nesse horário.",
  "nothing-fits": "Nenhuma das datas da série cabe na agenda. Veja a prévia e escolha outro dia ou horário.",
  changed: "Este atendimento foi alterado por outra pessoa. Atualize a página.",
  "too-early": "Só é possível registrar Realizada ou Falta depois do início do atendimento.",
  "not-allowed": "Você não tem permissão para essa mudança.",
  denied: "Não foi possível salvar. Confira os dados e tente de novo.",
  busy: "O sistema estava ocupado. Tente de novo.",
};
