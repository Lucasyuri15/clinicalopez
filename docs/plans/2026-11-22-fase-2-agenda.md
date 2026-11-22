# Plano — Fase 2: Agenda

Spec: `docs/specs/2026-11-22-fase-2-agenda.md`. Duas entregas, cada uma termina num PR: **2A (núcleo)**, branch `feat/fase-2a-agenda-nucleo` (a partir da `dev` em `7f4af2c`), e **2B (telas)**, branch `feat/fase-2b-agenda-telas`. TDD (RED → GREEN → REFACTOR). Verificação por tarefa: `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test <alvo>`.

## 2A — Núcleo
- [x] **T1** `wallParts` em `src/lib/datetime.ts` (+ testes, incluindo o horário de verão antigo).
- [x] **T2** `src/lib/schedule/availability.ts` (`checkSlot`) + testes (25).
- [x] **T3** `src/lib/schedule/calendar.ts` + testes (14), com os dias de 23 h e 25 h.
- [x] **T4** `src/lib/appointments/status.ts` e `labels.ts` + teste exaustivo (todos os papéis × todos os pares).
- [x] **T5** `src/lib/appointments/schemas.ts` (Zod de agendar, remarcar, cancelar, mudar status e filtros) + testes (37).
- [x] **T6** `schema.ts` (`appointments`, `appointment_prices`) e migração **0024**.
- [x] **T7** Migração **0025** (exclusões, gatilho, grants, políticas, `aal2`). Ensaiada numa transação desfeita antes de aplicar.
- [x] **T8** Testes de RLS por perfil: `appointments-rls.test.ts` (leitura, valor, catálogo) e `appointments-rls-write.test.ts` (escrita, conflito, gatilho, matriz de 180 pares, casos de borda da revisão). **Revisão independente feita.**
- [x] **T9** `addTimeOff` com trava exclusiva (`scheduleLockKey`) + teste com duas conexões reais.
- [x] **T10** `src/server/appointments/queries.ts` (`listAppointments`, `getAppointment`).
- [x] **T11** `mutations.ts` — criar (grade, folgas, serviço, vínculo, valor, conflito, atomicidade, concorrência).
- [x] **T12** `mutations.ts` — remarcar, cancelar e mudar status. Testes: `appointments-data.test.ts` (34).
- [x] **T13** `actions.ts` + testes (verificado por mutação: sem `requireRole`, 4 testes falham).
- [~] **T14** Docs e revisão final da 2A: spec e plano feitos; revisão da aplicação em andamento; falta atualizar `AGENTS.md`, `STATUS.md` e `PRD.md`.

## 2B — Telas (próxima entrega)
- [ ] **T15** Componentes de dia, semana e filtros (`src/components/agenda/*`).
- [ ] **T16** Gavetas de agendar/remarcar e de detalhe (cancelar e mudar status).
- [ ] **T17** `src/app/(app)/agenda/page.tsx` e testes de acesso por papel.
- [ ] **T18** Limpeza do e2e (`appointment_prices` e `appointments` antes de pacientes, profissionais e catálogo; em `deleteFixtureUser(s)` por `created_by` e `status_changed_by`) e `e2e/appointments.spec.ts`.
- [ ] **T19** Docs (`AGENTS`, `STATUS`, `PRD`), revisão final e conferência no navegador (desktop e celular).
