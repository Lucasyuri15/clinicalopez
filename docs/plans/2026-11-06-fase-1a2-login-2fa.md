# Plano — Fase 1A-2: login, 2FA e perfis

Spec: `docs/specs/2026-11-06-fase-1a2-login-2fa.md`. Branch: `feat/fase-1a2-login`. Commits locais por tarefa (Conventional Commits); push/PR só a pedido.

| # | Tarefa | Prova / verificação |
|---|---|---|
| 1 | Spec, plano e PRD | Revisão do texto |
| 2 | Dependências (`@supabase/ssr`, `@supabase/supabase-js`, `tsx`, `otpauth`) e env público (`src/lib/supabase/env.ts`), `.env.example`, regra do `NEXT_PUBLIC_` no AGENTS | Testes de env vermelhos antes |
| 3 | Spike no Supabase dev: usuário por SQL, `signInWithPassword`, campos do JWT, TOTP, `aal2`; registrar no spec | Saída do script |
| 4 | Lógica pura: `access.ts`, `steps.ts`, `schemas.ts` | Testes vermelhos antes |
| 5 | Clientes Supabase, `src/proxy.ts` e função de decisão | Testes da decisão; `pnpm build` |
| 6 | DAL `src/server/auth/session.ts` | Testes com mocks |
| 7 | Telas e actions: login, MFA (cadastro e verificação), logout | e2e + teste manual |
| 8 | Integração no app: menu do usuário, navegação por papel, `requirePageAccess` | e2e por papel |
| 9 | Comandos locais `users:link` e `users:reset-mfa` | Testes de argumentos; dry-run |
| 10 | Integração e e2e contra o dev (3 papéis, desktop e mobile); atualizar e2e existentes | `pnpm test:e2e` |
| 11 | Documentação (AGENTS, STATUS, README, PRD) | Revisão do texto |
| 12 | Revisão por subagente (auth/RBAC), verificação final e opções de integração | `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` |

Ordem: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12.
