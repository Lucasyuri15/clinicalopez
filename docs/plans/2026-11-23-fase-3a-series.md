# Plano — Fase 3A: séries e pacotes de sessões

Spec: `docs/specs/2026-11-23-fase-3a-series.md`. Branch `feat/fase-3a-series` (a partir da `dev` em `91098e7`). Duas entregas: **3A-1 (núcleo)** e **3A-2 (telas)**. TDD (RED → GREEN → REFACTOR). Verificação por tarefa: `pnpm lint && pnpm typecheck && pnpm test <alvo>`. Commits só quando o usuário pedir.

## 3A-1 — Núcleo
- [x] **T1** `src/lib/appointments/series.ts`: `generateOccurrences` (+ testes: 1 e 2+ dias/semana, virada de mês e ano, hora de parede, limites 2–60 e 1 ano).
- [x] **T2** `classifyOccurrence` (+ testes por motivo: `past`, `invalid-slot`, `outside-grid`, `time-off`, `conflict-professional`, `conflict-patient`).
- [x] **T3** `shiftSeriesFrom` (+ testes: para a frente, para trás, deslocamento de 2 dias com irmãs, só abertas e futuras) e `seriesProgress`.
- [x] **T4** Zod em `src/lib/appointments/schemas.ts`: prévia/criar, renovar, remarcar e cancelar daqui para frente (+ testes).
- [x] **T5** `schema.ts` (`appointmentSeries`, `appointments.seriesId`) e migração **0027** (`db:generate --custom`): tabela, FK composta, RLS, `aal2`, grants, gatilho reescrito. Ensaiar numa transação desfeita antes de aplicar no dev.
- [x] **T6** Testes de RLS: `appointment-series-rls.test.ts` (leitura, profissional sem acesso, catálogo) e `appointment-series-rls-write.test.ts` (insert, imutabilidade, FK composta, `aal1`).
- [x] **T7** Refatoração de `createAppointment` em `loadBookingContext` + `insertOccurrence` (sem mudar comportamento; os testes existentes são a rede).
- [x] **T8** `previewSeries`, `createSeries`, `renewSeries` (+ testes de dados no dev: tudo livre, uma data ocupada, corrida, nada cabe, valor copiado).
- [x] **T9** `cancelSeriesFrom` e `rescheduleSeriesFrom` (+ testes de dados, inclusive deslocamento de 2 dias).
- [x] **T10** `queries.ts` (`seriesId`, progresso só para a equipe) e `actions.ts` (5 ações, `requireRole("admin","reception")`, mensagens fixas) + linhas em `actions.test.ts`.
- [x] **T11** Docs da parte e **revisão independente** (migração/RLS/gatilho e mutações; obrigatória).

## 3A-2 — Telas
- [x] **T12** Agendar com "Repetir semanalmente": dias, nº de sessões, **Ver prévia**, **Criar N sessões**, resultado com as puladas.
- [x] **T13** Detalhe: progresso, escopo "só esta / esta e as seguintes" em remarcar e cancelar, **Renovar série**.
- [x] **T14** Selo "Série" no cartão e carga dos dados em `src/app/(app)/agenda/page.tsx`.
- [x] **T15** e2e `e2e/series.spec.ts` (admin e recepção; o profissional não vê nada de série, nem no HTML) e limpeza das séries em `e2e/support/db.ts`.
- [x] **T16** Docs (`PRD.md` 4.2, `AGENTS.md`, `STATUS.md`, spec), revisão independente das telas e revisão final da branch.
