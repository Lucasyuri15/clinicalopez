/**
 * Interface de armazenamento de anexos (PRD 6.1: portável; hoje Supabase Storage, amanhã um S3
 * compatível). Os arquivos são pequenos (até 4 MiB), então a interface trabalha com bytes. Resultados
 * são VALORES (nunca a mensagem do provedor, que pode trazer detalhe): quem chama decide o que dizer.
 *
 * Só `src/server/clinical/` usa isto (guarda: `storage-guard.test.ts`): é ele que confere autor,
 * papel e log antes de cada leitura/escrita.
 */
export type StoreFailure =
  /** Não existe, ou o usuário não o enxerga (a RLS esconde: o provedor responde igual). */
  | "not-found"
  /** Já existe um objeto neste caminho (nunca se sobrescreve). */
  | "exists"
  /** O provedor recusou (permissão, tipo ou tamanho). */
  | "rejected"
  /** Falha de rede ou do provedor. */
  | "unavailable";

export type StoreResult<T = undefined> = (T extends undefined ? { ok: true } : { ok: true; value: T }) | { ok: false; reason: StoreFailure };

export interface AttachmentStore {
  /** Grava NOVO objeto (sem sobrescrever). */
  put(path: string, bytes: Uint8Array, contentType: string): Promise<StoreResult>;
  /** Lê o objeto inteiro. */
  get(path: string): Promise<StoreResult<Uint8Array>>;
  /** Apaga o objeto. Só para desfazer um envio que o banco não registrou (órfão); anexo registrado nunca é apagado. */
  remove(path: string): Promise<StoreResult>;
}
