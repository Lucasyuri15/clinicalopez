# Plano — Fase 1B-2b: Grade de horários

Spec: `docs/specs/2026-11-17-fase-1b2b-grade-horarios.md`. Branch: `feat/fase-1b2b-grade-horarios`. TDD (RED → GREEN) em toda tarefa; revisão por subagente (obrigatória na T2 e na T6).

- **T0 — Preparo. (FEITO)** Branch, spec, este plano, base verde (`pnpm lint && pnpm typecheck && pnpm test`).
- **T1 — Regras puras. (FEITO)** `src/lib/schedule/{time,week,schemas}.ts` (horas em minutos, semana válida e sem sobreposição, Zod), `zonedToUtc`/`endOfDayUtc` em `src/lib/datetime.ts` (fuso de Brasília via `Intl`); testes ao lado.
- **T2 — Migração, schema e RLS (sensível). (FEITO)** Spike de `btree_gist` no dev; `schema.ts` + migrações (DDL gerado; exclusão, grants e RLS à mão); `pnpm db:migrate` só no dev; `src/server/db/schedule-rls.test.ts`.
- **T3 — Camada de dados. (FEITO)** `src/server/schedule/{queries,mutations}.ts` só com `withUser`; `src/server/db/schedule-data.test.ts` (fixtures do dono, apagados no fim).
- **T4 — Server Actions. (FEITO)** `src/server/schedule/actions.ts` (`saveWeekAction`, `addTimeOffAction`, `removeTimeOffAction`), `requireRole("admin")` primeiro; testes com mocks.
- **T5 — Telas. (FEITO)** `/profissionais/[id]/horarios` por papel (admin edita; recepção e profissional leem); botão "Horários" em `/profissionais`; `e2e/schedule.spec.ts`.
- **T6 — Revisão final e docs. (FEITO)** Subagente independente; corrigir crítico/importante; `STATUS.md`, `AGENTS.md`, spec.

Verificação final: `pnpm lint && pnpm typecheck && pnpm test`, `pnpm build`, `pnpm test:e2e`; `pnpm db:migrate` só no dev; conferência manual com os três papéis (desktop e celular).
