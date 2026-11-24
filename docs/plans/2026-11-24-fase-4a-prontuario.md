# Fase 4A — Prontuário em texto: plano de implementação

> **Executado em 2026-11-24** (T1 a T9). O que mudou em relação ao plano e o resultado da revisão estão na spec, seção "Como ficou". Commits: o usuário os faz.

> **Para quem executar:** use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans, tarefa a tarefa, com TDD (RED → GREEN → REFACTOR). Passos com `- [x]`. Depois da aprovação, este arquivo é copiado para `docs/plans/2026-11-24-fase-4a-prontuario.md` (convenção do projeto).

**Objetivo:** o profissional escreve, finaliza e adenda a evolução de um atendimento Realizado dele; só ele (e o admin, com registro) lê; a recepção não tem acesso; todo acesso vai para um log só de inclusão.

**Arquitetura:** três tabelas (`clinical_notes`, `clinical_note_addenda`, `clinical_access_log`) com RLS por autor, gatilhos que trancam a evolução finalizada e FK composta ao atendimento; camada `src/server/clinical/` (só `withUser`) que grava o log na mesma transação da leitura/escrita; seção "Prontuário" na ficha do paciente. Segue o modelo da lista de espera (migrações 0029–0033).

**Stack:** Next.js 16 (Server Actions), Drizzle + postgres, Zod v4, Supabase (dev), Vitest, Playwright.

**Spec:** `docs/specs/2026-11-24-fase-4a-prontuario.md` (inclui "Decisões de detalhe").

## Restrições globais (valem para toda tarefa)
- UI e mensagens em pt-BR; código, identificadores e commits em inglês; commit só quando o usuário pedir (Conventional Commits).
- Tabela nova: `.enableRLS()`, `REVOKE` de `anon`/`PUBLIC`, `GRANT` mínimo, política `RESTRICTIVE` de `aal2` (`<tabela>_require_aal2`), `REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` do `service_role`, teste de RLS por perfil e teste do **gatilho sozinho**.
- Acesso a dados só por `withUser`; resultados são **valores**, nunca erro do banco (`pgErrorCode`/`withoutQueryDetails` de `src/server/db/pg-error.ts`); mensagens fixas; **texto clínico nunca em log, URL, erro, `searchParams` ou cache**.
- Migrações: 0034 em diante, **só no Supabase dev**, ensaiadas numa transação desfeita antes de aplicar; nunca editar migração aplicada; usar `pnpm db:generate` (`--custom --name=...` para SQL à mão) para manter `meta/_journal.json` e snapshots.
- Toda Server Action chama `requireRole(...)` (o `server-actions-guard.test.ts` exige). Dados fictícios só, com etiqueta `[teste ...]`/`[e2e-cat ...]`.
- Datas fixas de teste exclusivas desta fase: **2031-10** (nenhum outro arquivo usa).

## Estrutura de arquivos
- Criar: `src/lib/clinical/schemas.ts` (+ `.test.ts`) · `src/server/db/clinical-rls-fixture.ts` · `clinical-rls.test.ts` · `clinical-rls-write.test.ts` · `clinical-data.test.ts` · `src/server/clinical/{access-log,queries,mutations,actions,messages}.ts` (+ testes) · `src/server/clinical/access-guard.test.ts` · `src/components/clinical/{record-section,note-sheet,addendum-sheet}.tsx` (+ teste do componente) · `e2e/clinical-record.spec.ts`.
- Modificar: `src/server/db/schema.ts` (tabelas, enums, `appointments_identity_uq`) · `src/server/db/migrations/` (0034, 0035, 0036) · `src/app/(app)/pacientes/[id]/page.tsx` · `e2e/support/db.ts` · `docs/PRD.md` · `AGENTS.md` · `docs/STATUS.md` · a spec ("Como ficou").

## Review Focus (cada linha tem um teste na tarefa dona)
1. **Dois profissionais no mesmo paciente:** B não lê nota nem adendo de A, nem adenda nota de A (T3/T4 RLS com `professional2`; T8 e2e com nota do colega semeada pelo dono).
2. **Profissional inativo ou removido** perde o acesso, e o paciente removido some para o profissional mas não para o admin (T3).
3. **Admin corrige Realizada → Falta** com evolução existente: a nota continua legível pelo autor e aparece na lista dele (T5, T7).
4. **Concorrência:** salvar × finalizar, e primeiro salvamento duas vezes ao mesmo tempo (índice único em `appointment_id`): nunca duas notas, nenhum erro cru (T5).
5. **Texto estranho:** só espaços, NUL e caracteres de controle/direção, exatamente 20 000 e 20 001 caracteres (contados por pontos de código), emoji (T1; NUL recusado no Zod porque o Postgres o rejeita com `22021`).
6. **Recepção:** abrir a ficha não consulta nem renderiza a seção; chamar a ação direto é barrado por `requireRole` (T6, T7, T8).

---

### Tarefa 1 — Regras puras (`src/lib/clinical/schemas.ts`)
**Produz:** `NOTE_MAX = 20_000`; `saveNoteSchema(): ZodType<{ appointmentId: string; body: string }>`; `finalizeNoteSchema(): ZodType<{ noteId: string }>`; `addendumSchema(): ZodType<{ noteId: string; body: string }>`. Mesmo estilo de `src/lib/waitlist/schemas.ts` (fábrica com `transform`, `uuidOf`, regex de controle `/[\u0000-\u001f\u007f-\u009f\p{Cf}]/u` **mas permitindo `\n` e `\t`** no texto, NFC, `trim`, tamanho por `[...text].length`, mensagens que **não repetem** o digitado).
- [x] Teste (RED, `schemas.test.ts`): corpo vazio e só espaços → erro "Escreva a evolução."; NUL e `‮` → erro; 20 000 passa e 20 001 falha; quebra de linha preservada; id inválido → erro; as mensagens nunca contêm o texto enviado.
- [x] Rode `pnpm vitest run src/lib/clinical` e veja falhar; implemente o mínimo; veja passar.
- [x] Commit `feat(clinical): add note validation schemas`.

### Tarefa 2 — Tabelas e chave única (migração 0034, gerada)
**Arquivos:** `src/server/db/schema.ts`; `pnpm db:generate --name=clinical_notes`.
**Declarar** (modelo `waitlistEntries`, linha ~722): enum `clinical_note_status` (`draft | finalized`); enum `clinical_access_action` (`read_note | read_history | create_note | update_draft | finalize | add_addendum`); `unique("appointments_identity_uq").on(id, patientId, professionalId)` em `appointments`; `clinicalNotes` (`id`, `appointmentId` **unique**, `patientId`, `professionalId`, `body` text not null com `check` 1–20 000, `status` default `draft`, `finalizedAt`, `finalizedBy` → `profiles.id`, `createdAt`, `updatedAt`; **FK composta** `(appointment_id, patient_id, professional_id)` → `appointments_identity_uq`, `onDelete restrict`; `check` `(status='finalized') = (finalized_at is not null)` e `finalized_by` junto); `clinicalNoteAddenda` (`id`, `noteId` → notes, `body` check 1–20 000, `createdBy` default `auth.uid()` → `profiles.id`, `createdAt` default now; índice em `noteId`); `clinicalAccessLog` (`id` bigint identity, `at` default now, `userId` default `auth.uid()`, `role` `user_role` default `app.current_app_role()`, `action`, `patientId` → patients, `noteId` nullable → notes; sem coluna de texto; índices por `patientId` e `at`). Todas `.enableRLS()`. Exportar os tipos.
- [x] Gerar, **ler o SQL** (só tabelas, FKs, checks, índices) e conferir que `appointments_identity_uq` entrou como `ADD CONSTRAINT` sem tocar na 0024.
- [x] Ensaiar numa transação desfeita (padrão das fases 3B), depois `pnpm db:migrate` (a trava confirma o projeto dev). Rode `pnpm typecheck`.
- [x] Commit `feat(db): add clinical notes tables`.

### Tarefa 3 — Acesso de leitura, grants e `aal2` (migração 0035, `--custom`)
**Fixture:** `clinical-rls-fixture.ts` → `seedClinical(tx, ids, label)` sobre `seedAgenda` (modelo `waitlist-rls-fixture.ts`): paciente vinculado a **dois** profissionais (`professional` e `professional2` do harness), atendimento Realizado de cada um, uma nota finalizada com adendo e um rascunho de cada autor, tudo inserido como dono.
- [x] **RED** (`clinical-rls.test.ts`, `harness.shared`, `describe.skipIf(!hasDb)`): admin lê as três tabelas (inclui rascunhos); autor lê só o dele; **`professional2` não lê nota nem adendo de `professional`** (e vice-versa); recepção, `stranger`, `inactive`, `deleted` não leem nada; `aal1` não lê; profissional com cadastro inativo/removido não lê; paciente removido: profissional não vê, admin vê; log: só admin lê; catálogo (`asOwner`): `anon`/`service_role` sem escrita, RLS ligada, política `*_require_aal2` presente (`catalog.test.ts` geral deve passar para as 3 tabelas).
- [x] Rode e veja falhar (sem grants/políticas).
- [x] **GREEN:** `pnpm db:generate --custom --name=clinical_access`. Conteúdo (modelo 0025/0030): `REVOKE ALL` de `PUBLIC, anon, authenticated`; `GRANT SELECT, INSERT` em notes/addenda/log para `authenticated`, `GRANT UPDATE (body, status)` em notes; **sem** `DELETE` em nenhuma; `service_role` sem `UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`; políticas `*_select_admin` (`app.current_app_role() = 'admin'`) e `*_select_own` (profissional **autor**: `EXISTS` em `professionals` com `id = clinical_notes.professional_id AND profile_id = auth.uid() AND deleted_at IS NULL AND active`; o adendo herda pelo `note_id`); `clinical_access_log_select_admin`; as três `*_require_aal2` (`RESTRICTIVE FOR ALL`). Cabeçalho explicando quem lê e por quê. (As políticas de **escrita** entram na T4.)
- [x] Ensaiar em transação desfeita, aplicar, rodar `clinical-rls.test.ts` e `catalog.test.ts` até passar.
- [x] Commit `feat(db): add clinical notes read policies`.

### Tarefa 4 — Escrita e gatilhos (migração 0036, `--custom`)
- [x] **RED** (`clinical-rls-write.test.ts`): só o profissional **autor** insere nota (admin, recepção, outro profissional, `aal1`: `42501`); insere só em atendimento **Realizado e dele** (agendado, falta, cancelado, de outro: erro); nasce sempre `draft`; `UPDATE` do corpo só em `draft` e só pelo autor; `finalize` carimba `finalized_at`/`finalized_by` com `auth.uid()` (valor do cliente ignorado/recusado); nota finalizada: nenhum `UPDATE` passa (nem autor); `appointment_id`/`patient_id`/`professional_id`/`created_at` imutáveis; adendo só em nota `finalized` **do próprio autor** e `created_by`/`created_at` do banco; sem `DELETE`/`UPDATE` em adendo e log; log: insere só admin e profissional, `user_id = auth.uid()`, `role` igual ao do banco, `note_id` só de nota que a pessoa enxerga; recepção e `aal1` não inserem. **Testes do gatilho sozinho** (modelo `unlock` de `waitlist-rls-write.test.ts`: `grant` + `disable row level security` em savepoint desfeito) para cada regra de transição e para o adendo.
- [x] Rode e veja falhar.
- [x] **GREEN:** `--custom --name=clinical_write_guards`: políticas `INSERT`/`UPDATE` (autor) com `WITH CHECK`; funções `app.clinical_notes_guard_insert()` e `app.clinical_notes_guard_update()` e `app.clinical_addenda_guard_insert()` (modelo `app.waitlist_guard_update()`: `SET search_path=''`, `v_uid := auth.uid()`, `IF v_uid IS NULL THEN RETURN NEW` para o dono, `42501` com texto fixo, `23514` para regra de negócio, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `CREATE TRIGGER`). `updated_at` mantido pelo gatilho.
- [x] Ensaiar, aplicar, passar `clinical-rls-write.test.ts` + suíte de RLS inteira.
- [x] Revisão independente da RLS e dos gatilhos (obrigatória, contexto enxuto: spec + migrações + testes). Corrigir críticos e importantes (correção = **nova** migração se já aplicada).
- [x] Commit `feat(db): add clinical notes write policies and guards`.

### Tarefa 5 — Camada de dados (`src/server/clinical/`)
**Interfaces:**
```ts
// access-log.ts
recordAccess(tx: Tx, e: { action: ClinicalAccessAction; patientId: string; noteId?: string }): Promise<void>
// queries.ts  (cada função exportada chama recordAccess)
type ClinicalUser = { userId: string; role: UserRole };
type NoteView = { id; appointmentId; startsAt: Date; serviceName; professionalName; status: "draft"|"finalized"; body: string; createdAt: Date; finalizedAt: Date | null; addenda: { id; body: string; createdAt: Date; authorName: string }[] };
type PendingView = { appointmentId: string; startsAt: Date; serviceName: string };
getPatientRecord(user: ClinicalUser, patientId: string): Promise<{ notes: NoteView[]; pending: PendingView[] } | null>
// mutations.ts
type ClinicalFailure = "not-found" | "not-realized" | "locked" | "not-finalized" | "denied" | "busy";
type ClinicalResult = { ok: true; noteId: string } | { ok: false; reason: ClinicalFailure };
saveNote(user: { userId: string }, input: { appointmentId: string; body: string }): Promise<ClinicalResult>      // cria rascunho no 1º salvamento; atualiza se rascunho; `locked` se finalizada
finalizeNote(user, input: { noteId: string }): Promise<ClinicalResult>                                           // UPDATE ... WHERE status='draft'
addAddendum(user, input: { noteId: string; body: string }): Promise<ClinicalResult>                              // `not-finalized` se rascunho
// messages.ts
CLINICAL_MESSAGES: Record<ClinicalFailure | "generic", string>   // pt-BR fixas
```
Regras: `getPatientRecord` devolve `null` **sem tocar no banco** para `reception`; para admin vê todas as notas (rascunhos marcados), `pending = []`; para profissional vê as dele e `pending` = atendimentos Realizados dele com o paciente sem nota; **a lista inclui nota de atendimento hoje Falta** (Review Focus 3). Log por chamada: 1 `read_history` + 1 `read_note` por nota devolvida, **na mesma transação**. Mutations resolvem o profissional autor dentro do `withUser` (`professionals.profile_id = auth.uid()`), classificam `23505` (corrida do 1º salvamento) como `busy`, e gravam `create_note`/`update_draft`/`finalize`/`add_addendum`. Nada do texto em erro/log.
- [x] **RED** (`clinical-data.test.ts`, fixtures commitados pelo dono com `TAG`, dias 2031-10, limpeza na ordem log → adendo → nota): fluxo criar/salvar/finalizar/adendar; `locked` após finalizar; rascunho vazio nunca existe; `not-realized` em atendimento agendado; **N textos devolvidos = N linhas `read_note`** e nenhuma linha contém texto; recepção → `null` e **zero** linhas de log; admin lê tudo, não grava (`denied`); corrida salvar × finalizar e 1º salvamento em paralelo (uma nota só, resultado `ok` ou `busy`, nunca erro cru); Realizada → Falta pelo admin mantém a nota visível ao autor.
- [x] `access-guard.test.ts` (`@vitest-environment node`, modelo `server-actions-guard.test.ts`): falha se `clinicalNotes|clinicalNoteAddenda|clinicalAccessLog` aparecerem fora de `src/server/clinical/**`, `src/server/db/**` e testes; falha se uma função exportada de `queries.ts` não chamar `recordAccess`. (Preferido ao ESLint: `schema.ts` é um arquivo único importado por todos.)
- [x] Veja falhar, implemente o mínimo, veja passar.
- [x] Commit `feat(clinical): add clinical data layer with access log`.

### Tarefa 6 — Server Actions (`src/server/clinical/actions.ts`)
**Interfaces:** `"use server"`; `type ClinicalFormState = { error?: string; success?: true; values?: Record<string,string> } | undefined`; `saveNoteAction`, `finalizeNoteAction`, `addAddendumAction` — `(prev, formData) => Promise<ClinicalFormState>`, **todas começam com `requireRole("professional")`** (admin não escreve); parse com os schemas da T1; `userId` vem da sessão, nunca do form; mapeiam `reason` para `CLINICAL_MESSAGES`; `revalidatePath("/pacientes/[id]", "page")`; devolvem os valores digitados no erro (padrão `echo`/`fail` de `src/server/waitlist/actions.ts`).
- [x] **RED** (`actions.test.ts`, modelo `src/server/waitlist/actions.test.ts`): mocks de `@/server/auth/session`, `next/cache` e `./mutations`; admin e recepção redirecionados (`RedirectSignal`) sem chamar a mutation; `userId` da sessão; mensagem fixa por `reason`; erro de validação sem repetir o texto; `revalidatePath` chamado no sucesso; o guarda global de ações continua verde.
- [x] Veja falhar, implemente, veja passar. Commit `feat(clinical): add clinical server actions`.

### Tarefa 7 — Seção "Prontuário" na ficha
**Interfaces:** `RecordSection({ patientId, patientName, role, notes, pending }): JSX` (server component, modelo `ConsentCard`); `NoteSheet({ appointmentId, label, initialBody?, mode })` e `AddendumSheet({ noteId, label })` (client; `Sheet` + `useFormAction` de `src/components/agenda/form-action.tsx`; `FormErrorBox`). Em `page.tsx`: `const canReadRecord = user.role !== "reception"` e **só então** chamar `getPatientRecord` e renderizar a seção, **fora** do bloco `isStaff`. Admin: somente leitura, com nome do profissional autor e marca "Rascunho"; profissional: "Escrever evolução" (pendentes), "Continuar" (rascunho), "Finalizar" com confirmação clara de que não dá para editar depois (reaproveite o padrão da confirmação "Tirar da espera"), "Adicionar adendo" (finalizadas). Texto com `whitespace-pre-wrap`; datas em Brasília (`src/lib/datetime.ts`). Botões com rótulo acessível que inclui o atendimento.
- [x] **RED** (teste do componente, modelo `waitlist-suggestion.test.tsx`; `vi.hoisted` + `vi.mock` das ações; `scrollIntoView` stub): profissional vê "Escrever evolução" por pendente; admin não vê nenhum botão de escrever; nota finalizada mostra adendos e esconde "Continuar"; "Finalizar" pede confirmação; erro aparece no formulário e o texto digitado permanece.
- [x] Implemente, passe, rode `pnpm lint && pnpm typecheck`. Commit `feat(clinical): add prontuário section to patient page`.

### Tarefa 8 — e2e (desktop e celular)
**Em `e2e/support/db.ts`:** `seedClinicalNote({ patientName, professionalName, appointmentStartsAt, body, status })` (dono, só nomes com etiqueta), `clinicalState(tag)` (lê notas e contagem de log), e **`deletePatients` apaga log → adendos → notas antes de `patients`**; helper para vincular o paciente a mais um profissional (`seedPatients` já cria `own`/`ownForeign`/`other`). **Limite conhecido:** só há **um** login de profissional por projeto; "o segundo não lê" é provado no e2e com uma nota do colega semeada pelo dono e, no banco, pela RLS (T3/T4, `professional2` real).
- [x] **RED** (`e2e/clinical-record.spec.ts`, `describe.configure({ mode: "serial" })` no bloco do profissional; `testAs(role)`; `test.skip(!HAS_SUPABASE)`): profissional escreve → salva rascunho → finaliza (confirmação) → adenda, e `clinicalState` confirma texto e log; a nota do colega no mesmo paciente **não aparece**; recepção abre a ficha e **não há** seção nem botão; admin lê a nota do colega, sem botão de escrever, e o log registra a leitura; `rbac.spec.ts` ganha o caso da recepção.
- [x] Rode `pnpm test:e2e e2e/clinical-record.spec.ts`, veja falhar pelo motivo certo; ajuste a implementação (não o teste); veja passar nos dois projetos. Commit `test(e2e): cover clinical record flows`.

### Tarefa 9 — Fechamento
- [x] Revisão final independente da branch (RBAC, RLS, dado clínico; contexto enxuto) e correção dos críticos e importantes; menores vão para a spec.
- [x] **Verificação completa nesta resposta:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` e `pnpm test:e2e`; ler a saída e o código de saída; conferir que o banco dev ficou sem sobras com etiqueta.
- [x] Atualizar `docs/PRD.md` (4.4: evolução, adendo e log feitos; anexos na 4B), `AGENTS.md` (linha "Instalado (Fase 4A…)" e estrutura), a spec ("Como ficou", incluindo o limite do e2e) e `docs/STATUS.md`. Commit `docs: record Phase 4A`; só então o usuário abre o PR para a `dev`.

## Verificação de ponta a ponta
`pnpm vitest run src/server/db/clinical-*.test.ts src/server/clinical src/lib/clinical` (RLS, gatilhos, dados, guarda e regras) → `pnpm test` completo → `pnpm test:e2e` → conferência manual (do usuário): login do profissional, escrever, finalizar e adendar; login da recepção sem a seção; login do admin lendo.
