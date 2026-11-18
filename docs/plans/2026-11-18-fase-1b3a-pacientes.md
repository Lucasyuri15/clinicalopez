# Plano — Fase 1B-3a: Pacientes (cadastro)

Spec: `docs/specs/2026-11-18-fase-1b3-pacientes.md`. Branch: `feat/fase-1b3a-pacientes`. TDD (RED → GREEN) em toda tarefa; revisão por subagente **obrigatória** na T2 (migração/RLS) e na T6 (final).

- **T0 — Preparo.** Branch, spec, este plano, base verde (`pnpm lint && pnpm typecheck && pnpm test`).
- **T1 — Regras puras** (`src/lib/patients/`): `cpf.ts` (normaliza, valida dígitos, formata, recusa sequências iguais), `schemas.ts` (Zod: "sem CPF" ⇒ motivo obrigatório e CPF vazio; menor de 18 ⇒ responsável obrigatório; datas, UF, CEP), `labels.ts`; reusa `src/lib/phone.ts`.
- **T2 — Migração, schema e RLS (sensível).** `schema.ts` + migrações `0017+` (DDL gerado; grants, políticas e CHECKs à mão); `pnpm db:migrate` só no dev; `src/server/db/patients-rls.test.ts`.
- **T3 — Camada de dados** (`src/server/patients/{queries,mutations}.ts`, só `withUser`): `listPatients`, `getPatient`, `savePatient` (atômico), `setPatientStatus`, `removePatient`; `src/server/db/patients-data.test.ts`.
- **T4 — Server Actions** (`src/server/patients/actions.ts`): `requireRole` primeiro; Zod; mensagens fixas em pt-BR; testes com mocks.
- **T5 — Telas:** `/pacientes` (lista, busca, gaveta de cadastro) e `/pacientes/[id]` (detalhe por papel); registrar a rota em `access.ts`; e2e.
- **T6 — Revisão final e docs.** Subagente independente; corrigir crítico/importante; `STATUS.md`, `AGENTS.md`, spec.

**1B-3b (consentimentos)** vira plano próprio depois do merge da 3a.

Verificação final: `pnpm lint && pnpm typecheck && pnpm test`, `pnpm build`, `pnpm test:e2e`; `pnpm db:migrate` só no dev; conferência manual com os três papéis (desktop e celular). Só dados fictícios.
