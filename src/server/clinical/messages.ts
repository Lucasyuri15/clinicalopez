import type { AttachmentFailure } from "./attachments";
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

/** Mensagens FIXAS dos anexos (Fase 4B-1): nunca o nome do arquivo, texto do banco nem do Storage. */
export const ATTACHMENT_MESSAGES: Record<AttachmentFailure | "generic" | "no-file", string> = {
  generic: "Não foi possível anexar. Tente novamente.",
  "no-file": "Escolha um arquivo.",
  empty: "O arquivo está vazio.",
  "too-large": "O arquivo é maior que 4 MB. Envie um arquivo menor ou uma foto de resolução menor.",
  "bad-type": "Tipo de arquivo não permitido. Envie PDF, JPEG, PNG ou WebP.",
  "not-found": "Este paciente, atendimento ou anexo não está mais disponível. Atualize a página.",
  "not-realized": "Só é possível ligar o anexo a um atendimento realizado.",
  duplicate: "Este arquivo já foi anexado a este paciente.",
  denied: "Não foi possível anexar. Confira o arquivo e tente de novo.",
  busy: "O sistema estava ocupado. Tente de novo.",
  unavailable: "O armazenamento de arquivos está indisponível agora. Tente de novo em instantes.",
};
