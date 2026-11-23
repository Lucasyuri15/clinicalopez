# Plano — Fase 3B: lista de espera

Spec: `docs/specs/2026-11-23-fase-3b-lista-espera.md`. Branch `feat/fase-3b-espera` (a partir da `dev` em `49c1967`). Duas entregas: **3B-1 (núcleo e cadastro)** e **3B-2 (sugestão e agendar)**. TDD (RED → GREEN → REFACTOR). Verificação por tarefa: `pnpm lint && pnpm typecheck && pnpm test <alvo>`. Commits só quando o usuário pedir.

## 3B-1 — Núcleo e cadastro
- [x] **T1** `src/lib/waitlist/match.ts`: `matchesPreference` e `describePreference` (+ testes: dia, faixa, vazio = qualquer, borda da faixa, fuso de Brasília).
- [x] **T2** `src/lib/waitlist/schemas.ts` e `labels.ts`: Zod de cadastro, edição, remoção e "agendar da espera" (+ testes: dias 0–6 sem repetição, faixa de 5 em 5 com início < fim ≤ 24:00, ambos ou nenhum, nota ≤ 200).
- [x] **T3** `schema.ts` (`waitlistEntries`, enum `waitlist_status`) e migração **0029** (`db:generate`) + **0030** (`db:generate --custom`): grants, políticas, `aal2`, gatilho. Ensaiar numa transação desfeita antes de aplicar no dev. *(Acrescentou-se a **0031**: o teste de RLS achou que a política de UPDATE impedia tirar da espera quem aguardava um profissional depois removido; a 0030 já estava aplicada, então a correção é migração nova.)*
- [x] **T4** Testes de RLS: `waitlist-rls.test.ts` (leitura por perfil, profissional sem acesso, recepção × removidos, catálogo) e `waitlist-rls-write.test.ts` (insert forjado, aal1, colunas do UPDATE, gatilho, sem DELETE/TRUNCATE, unicidade da aberta); cenário em `waitlist-rls-fixture.ts`.
- [x] **T5** `src/server/waitlist/queries.ts` (`listWaitlist`) e `mutations.ts` (`addEntry`, `updateEntry`, `removeEntry`) + testes de dados no dev.
- [x] **T6** `actions.ts` (todas `requireRole("admin","reception")`, mensagens fixas) + testes de ação.
- [x] **T7** Registro da tela: `SCREEN_ACCESS`, `NAV_ITEMS`, `access.test.ts`, `navigation.test.ts`, `e2e/rbac.spec.ts`.
- [x] **T8** Tela `/lista-espera` (lista, filtros na URL, gaveta de cadastro/edição com `PatientPicker`, "Tirar da espera", "Encerradas").
- [x] **T9** e2e `e2e/waitlist.spec.ts` (admin e recepção cadastram, editam e removem; o profissional não vê item nem rota) e limpeza em `e2e/support/db.ts` (só com a etiqueta `[e2e-cat xxxxxxxx]`).
- [x] **T10** Docs da parte e **revisão independente** (migração/RLS/gatilho e dados; obrigatória).

## 3B-2 — Sugestão e agendar
- [ ] **T11** `cancelAppointment` devolve o horário liberado (professional, especialidade, início, fim) sem mudar o comportamento (+ teste).
- [ ] **T12** `findCandidates` (+ testes de dados: cabe, outro dia, fora da faixa, outro profissional, serviço não oferecido, conflito do paciente, passado, folga, ordem de chegada, teto de 10).
- [ ] **T13** `bookFromWaitlist` (exporta `assertSlot`; reusa `guarded`, `lockSchedule`, `loadBookingContext`, `insertOccurrence`, `linkPatient`) (+ testes: atômico, espera já fechada desfaz o atendimento, duas esperas no mesmo horário, corrida).
- [ ] **T14** Ações `cancelAppointmentAction` (candidatos à prova de falha) e `bookFromWaitlistAction` + testes (a falha da busca não derruba o cancelamento).
- [ ] **T15** Painel na gaveta de cancelar (`keepOpen` + `SummaryPanel`, cartão por candidato, botão **Agendar**).
- [ ] **T16** e2e do fluxo completo (cadastra → cancela → vê o candidato → agenda com um clique; sem espera, a gaveta fecha como hoje; profissional sem nada).
- [ ] **T17** Docs (`PRD.md` 4.2, `AGENTS.md`, `STATUS.md`, spec), revisão independente das telas e revisão final da branch; verificação completa (`lint`, `typecheck`, `test`, `build`, `test:e2e`) e conferência no navegador.
