# Plano — Fase 1B-2a: Profissionais

Spec: `docs/specs/2026-11-17-fase-1b2a-profissionais.md`. Branch: `feat/fase-1b2a-profissionais`. TDD (RED → GREEN) em toda tarefa; revisão por subagente (obrigatória na T2 e na T6).

- **T0 — Preparo. (FEITO)** Branch, spec, este plano, base verde (`pnpm lint && pnpm typecheck && pnpm test`).
- **T1 — Regras puras. (FEITO)** `src/lib/professionals/schemas.ts` (Zod), `src/lib/professionals/labels.ts` (`councilLabel`), `src/lib/phone.ts` (`normalizePhone`, `formatPhone`); `name` exportado de `src/lib/catalog/schemas.ts`; testes ao lado.
- **T2 — Migração, schema e RLS (sensível). (FEITO)** `schema.ts` + migrações (DDL gerado e RLS custom); `pnpm db:migrate` só no dev; `src/server/db/professionals-rls.test.ts` (por perfil e tabela, `aal1`, FKs compostas, únicos, DELETE); `catalog.test.ts` segue verde.
- **T3 — Camada de dados. (FEITO)** `src/server/professionals/{queries,mutations}.ts` só com `withUser`; `src/server/db/professionals-data.test.ts` (fixtures do dono, apagados no fim).
- **T4 — Server Actions. (FEITO)** `src/server/professionals/actions.ts` (`saveProfessional`, `setProfessionalActiveAction`), `requireRole("admin")` primeiro; testes com mocks.
- **T5 — Telas. (FEITO)** `/profissionais` por papel (admin edita; recepção lê; profissional "Meu cadastro"); `access.ts` e testes; `e2e/professionals.spec.ts`; `rbac`/`navigation` specs.
- **T6 — Revisão final e docs. (FEITO)** Subagente independente; corrigir crítico/importante; `STATUS.md`, `AGENTS.md`, spec.

Verificação final: `pnpm lint && pnpm typecheck && pnpm test`, `pnpm build`, `pnpm test:e2e`; `pnpm db:migrate` só no dev; conferência manual com os três papéis (desktop e celular).
