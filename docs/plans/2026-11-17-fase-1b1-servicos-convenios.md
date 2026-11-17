# Plano — Fase 1B-1: Serviços e Convênios

Spec: `docs/specs/2026-11-17-fase-1b1-servicos-convenios.md`. Branch: `feat/fase-1b1-servicos-convenios`. TDD (RED → GREEN) em toda tarefa; revisão por subagente (obrigatória na T2 e na T6).

- **T0 — Preparo.** (FEITO) Branch, spec, este plano, base verde (`pnpm lint && pnpm typecheck && pnpm test`).
- **T1 — Regras puras. (FEITO)** `src/lib/catalog/schemas.ts` (Zod: serviço, convênio, valor), `src/lib/catalog/labels.ts` (especialidades em pt-BR), `parseBRLToCents` em `src/lib/money.ts`; testes ao lado.
- **T2 — Migração, schema e RLS (sensível). (FEITO)** `src/server/db/migrations/0006_catalog.sql` (via `pnpm db:generate --custom`), `src/server/db/schema.ts`, `pnpm db:migrate` só no dev; `src/server/db/catalog-rls.test.ts` (por perfil e tabela; `aal1`; sem DELETE; únicos e checks); `catalog.test.ts` segue verde.
- **T3 — Camada de dados. (FEITO)** `src/server/catalog/queries.ts` só com `withUser` (`listServices`, `listInsurances`, `listPrices`); testes de integração com fixtures commitados pelo dono e apagados no fim.
- **T4 — Server Actions. (FEITO)** `src/server/catalog/actions.ts` (`"use server"`): `saveService`, `setServiceActive`, `saveInsurance`, `setInsuranceActive`, `setPrice`, `removePrice`, todas com `requireRole("admin")` e Zod; testes com mocks; `server-actions-guard.test.ts` cobre o arquivo.
- **T5 — Telas. (FEITO)** Componentes shadcn necessários; `/servicos` e `/convenios` (+ detalhe com valores); `access.ts` (`servicos`: admin/reception/professional; `convenios`: admin/reception), `navigation.ts` e seus testes; `requirePageAccess` em cada página; e2e `e2e/catalog.spec.ts` por papel (o profissional não vê valor nem `/convenios`).
- **T6 — Revisão final e docs. (FEITO)** Subagente independente sobre o diff; corrigir crítico/importante; atualizar `docs/STATUS.md`, `AGENTS.md` e a spec.

Verificação final: `pnpm lint && pnpm typecheck && pnpm test`, `pnpm build`, `pnpm test:e2e`; `pnpm db:migrate` só no dev; conferência manual com os três papéis (desktop e celular).
