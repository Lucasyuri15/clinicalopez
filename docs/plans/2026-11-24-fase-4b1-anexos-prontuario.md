# Fase 4B-1 — Anexos do prontuário: plano de implementação

> **Para quem executar:** tarefa a tarefa, com TDD (RED → GREEN → REFACTOR). Passos com `- [ ]`. Spec: `docs/specs/2026-11-24-fase-4b-anexos.md` (decisões, modelo de dados e abordagem técnica). Restrições globais do projeto: `AGENTS.md` (pt-BR na UI, inglês no código, commit só quando o usuário pedir, nunca dado real, nunca chave secret no app, nunca editar migração aplicada, migrações só no Supabase dev).

## Tarefas da 4B-1 (TDD, uma revisão independente nas de RLS/Storage e uma final)
- [x] **T1.** *(catálogo provado; HTTP fica para T6/T10, ver spec)* **Spike curto (descartável):** confirmar no dev que o Storage aceita upload/download com o JWT do usuário e que uma política em `storage.objects` consultando `clinical_attachments` funciona; registrar o resultado na spec. Se não funcionar, parar e voltar ao dono.
- [x] **T2.** **Regras puras** `src/lib/attachments/` (`sniff.ts`, `schemas.ts`, `limits.ts`, nome seguro) + testes: renomeado `.exe`→`.pdf`, SVG, HTML, vazio, 4 MiB exato × +1, nome com RTL/`../`/controle.
- [x] **T3.** **Tabela + log** (schema.ts, migração gerada) e **leitura/grants/aal2** (custom) com RLS por perfil: autor só o dele, **dois profissionais no mesmo paciente**, admin lê tudo, recepção/`aal1`/inativo/removido nada.
- [x] **T4.** **Escrita e gatilhos** (custom) + testes, incluindo "gatilho sozinho" (padrão da 4A) e a nova regra do log.
- [x] **T5.** **Bucket e políticas de `storage.objects`** + testes por SQL como cada papel (insert, select via linha visível, órfão, sem update).
- [x] **T6.** **Interface de storage** + driver Supabase + falso em memória (+ guarda de importação).
- [x] **T7.** **Camada de dados** (`uploadAttachment`, `removeAttachment`, `openAttachment`, `getPatientRecord` com anexos) contra o dev com o falso: log N=N, falha fechada, órfão limpo, corrida de duplo clique, paciente removido, atendimento de outro profissional.
- [x] **T8.** **Ação + Route Handler + `bodySizeLimit`**: testes (`requireRole`, mensagens fixas, cabeçalhos, recepção barrada, guarda global de Server Actions verde).
- [x] **T9.** **UI** (cartão, gaveta, redução de foto, remover com confirmação) + teste de componente.
- [x] **T10.** **e2e com Storage real** (desktop e celular): profissional anexa PDF e PNG pequenos, abre, remove; arquivo falso é recusado; recepção sem cartão e rota direta barrada; admin lê e o log registra. Só um login de profissional por projeto: o isolamento entre profissionais fica provado nos testes de RLS (como na 4A). `e2e/support/db.ts` ganha limpeza de anexos antes de apagar pacientes.
- [ ] **T11.** **Fechamento:** revisão final da branch, `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`, spec "Como ficou", `docs/PRD.md` (4.4), `AGENTS.md`, `docs/STATUS.md`. Commit só quando o dono pedir (PR para `dev`).

## Review Focus (cada linha vira teste na tarefa dona)
- [ ] **T1.** **Paciente errado:** anexo enviado e removido; removido some para o autor e aparece marcado ao admin (T4, T7, T9).
- [ ] **T2.** **Arquivo disfarçado** (`.exe` como `.pdf`, SVG, HTML, bytes vazios, tipo do navegador mentindo) (T2, T7).
- [ ] **T3.** **Tamanho:** 4 MiB exato passa, +1 byte falha, nos 3 níveis (navegador, ação, banco) (T2, T3, T8).
- [ ] **T4.** **Falha no meio:** Storage ok e banco falha (órfão limpo); banco ok e leitura do Storage falha (nada entregue, log gravado) (T7).
- [ ] **T5.** **Dois profissionais no mesmo paciente** não leem, não removem e não anexam em atendimento um do outro (T3, T4, T5).
- [ ] **T6.** **Recepção** chamando a ação ou a rota direto, e abrindo a ficha (T8, T10).
- [ ] **T7.** **Nome do arquivo** com `../`, RTL, controle, 120+ caracteres; nunca em URL/log/erro (T2, T8).
- [ ] **T8.** **Duplo clique no envio** e remover duas vezes (T7).

## Verificação
`pnpm vitest run src/lib/attachments src/server/clinical src/server/storage src/server/db/clinical-attach*` → `pnpm lint && pnpm typecheck && pnpm test && pnpm build` → `pnpm test:e2e e2e/clinical-attachments.spec.ts` e depois o e2e completo; conferência manual do dono (login com 2FA) com profissional e admin; conferir no painel do Supabase dev que o bucket é privado e que nada ficou com etiqueta de teste.
