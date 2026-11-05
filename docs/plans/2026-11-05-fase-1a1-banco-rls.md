# Plano — Fase 1A-1: banco, Drizzle e RLS

Spec: `docs/specs/2026-11-05-fase-1a1-banco-rls.md`. Branch: `feat/fase-1a-acesso-dados`. Commits locais por tarefa (Conventional Commits); push/PR só a pedido.

| # | Tarefa | Arquivos | Prova / verificação |
|---|---|---|---|
| 0 | Spike de conectividade: login como `app_backend` no pooler e `set local role authenticated`. Registrar resultado no spec. Depende do `.env.local` do usuário | `.env.local` (fora do Git), spec | Consulta `select current_user` OK pelo pooler |
| 1 | Spec e plano em docs; PRD seção 6 (ORM = Drizzle, dois papéis) | `docs/specs/*`, `docs/plans/*`, `docs/PRD.md` | Revisão do texto |
| 2 | Env validado com Zod (erro em pt-BR, sem vazar valores) e `.env.example` | `src/server/env.ts`, `src/server/env.test.ts`, `.env.example` | `pnpm test` (vermelho antes do código) |
| 3 | Drizzle + migração base (enum, `profiles`, papel `app_backend`, grants, `app.current_role()`, RLS). Scripts `db:generate` e `db:migrate` (trava de projeto dev) | `drizzle.config.ts`, `src/server/db/schema.ts`, `src/server/db/migrations/*.sql`, `package.json` | `pnpm db:migrate` no dev; RLS visível no painel |
| 4 | Cliente e `withUser` | `src/server/db/client.ts`, `src/server/db/with-user.ts`, teste de integração | `current_user = 'authenticated'` e `auth.uid()` correto dentro; negado fora |
| 5 | Testes de RLS por perfil (admin, recepção, profissional, sem contexto, inativo) | `src/server/db/rls.test.ts` | Vistos falhando antes das políticas e passando depois |
| 6 | Seed de DEV (provavelmente adiado para a 1A-2) | — | — |
| 7 | Documentação: AGENTS.md, STATUS.md, README | docs | Revisão do texto |
| 8 | Revisão por subagente, verificação final e opções de integração | — | `pnpm lint && pnpm typecheck && pnpm test && pnpm build` |

Ordem: 1 → 2 → (usuário cria `.env.local`) → 0 → 3 → 4 → 5 → 7 → 8.
