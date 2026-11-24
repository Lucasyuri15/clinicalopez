import type { ClinicalFailure } from "./mutations";

/**
 * Mensagens FIXAS em pt-BR para cada motivo de recusa do prontuário (nunca texto do banco nem o que
 * foi digitado). Num módulo comum porque um arquivo `"use server"` só pode exportar funções.
 */
export const CLINICAL_MESSAGES: Record<ClinicalFailure | "generic", string> = {
  generic: "Não foi possível salvar. Tente novamente.",
  "not-found": "Este atendimento ou evolução não está mais disponível. Atualize a página.",
  "not-realized": "Só é possível escrever a evolução de um atendimento realizado.",
  locked: "Esta evolução já foi finalizada e não pode mais ser editada. Use um adendo.",
  "not-finalized": "O adendo só pode ser feito em uma evolução finalizada.",
  denied: "Não foi possível salvar. Confira o texto e tente de novo.",
  busy: "O sistema estava ocupado. Tente de novo.",
};
