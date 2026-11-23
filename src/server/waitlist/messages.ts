import { FAILURE_MESSAGES } from "@/server/appointments/messages";

import type { WaitlistFailure } from "./mutations";

/**
 * Mensagens FIXAS em pt-BR para cada motivo de recusa da lista de espera (nunca texto do banco nem o
 * que foi digitado, como a nota). Num módulo comum porque um arquivo `"use server"` só pode exportar
 * funções.
 */
export const WAITLIST_MESSAGES: Record<WaitlistFailure | "generic", string> = {
  generic: "Não foi possível concluir. Tente novamente.",
  "not-found": "Paciente, serviço, profissional ou registro não encontrado. Atualize a página e tente de novo.",
  "service-not-offered": "Este profissional não realiza o serviço escolhido.",
  duplicate: "Esse paciente já está na espera por esse serviço (e profissional). Edite o registro que já existe.",
  changed: "Este registro foi alterado por outra pessoa. Atualize a página.",
  denied: "Não foi possível salvar. Confira os dados e tente de novo.",
  busy: "O sistema estava ocupado. Tente de novo.",
};

/**
 * Agendar da espera recusa pelos mesmos motivos da agenda; só duas mensagens falam da ESPERA (o
 * "atendimento alterado" da agenda confundiria quem clicou em Agendar numa espera que sumiu).
 */
export const BOOK_FAILURE_MESSAGES: typeof FAILURE_MESSAGES = {
  ...FAILURE_MESSAGES,
  "not-found": "Esta espera não está mais disponível. Atualize a página.",
  changed: "Esta espera já foi atendida ou retirada da lista. Atualize a página.",
};
