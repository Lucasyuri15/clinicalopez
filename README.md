# López + Saúde — Agendamentos

Sistema interno de agendamentos e gestão da clínica familiar López + Saúde
(Fisioterapia, Odontologia e Psicologia).

- Requisitos e decisões: [`docs/PRD.md`](docs/PRD.md)
- Regras para agentes de IA, comandos e convenções: [`AGENTS.md`](AGENTS.md)

## Como rodar

Pré-requisitos: Node.js 20.9 ou superior e [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Na primeira vez, instale o navegador usado nos testes e2e:

```bash
pnpm exec playwright install chromium
```

## Banco de dados (Supabase)

Copie `.env.example` para `.env.local` e preencha `DATABASE_URL`, `DIRECT_URL` e
`MIGRATION_PROJECT_REF` (nunca versione esse arquivo nem cole os valores em chats ou issues).

```bash
pnpm db:generate   # gera migração a partir de src/server/db/schema.ts (--custom para SQL à mão)
pnpm db:migrate    # aplica migrações; recusa se o projeto não for o de MIGRATION_PROJECT_REF
```

## Login e usuários

Todas as telas exigem login (e-mail + senha) e 2FA com app autenticador. Não há cadastro público.

```bash
# 1) crie o usuário no painel do Supabase: Authentication → Users → Add user (Auto Confirm)
# 2) vincule o papel (admin, reception ou professional):
pnpm users:link maria@clinica.com reception "Maria Souza"
# celular perdido? remove o 2FA do usuário (sem --yes só simula):
pnpm users:reset-mfa maria@clinica.com --yes
```

O app acessa o banco só pelo servidor, sob RLS, via `withUser` (ver `AGENTS.md`).
Sem `.env.local`, os testes de integração do banco e os e2e são pulados.

## Verificação

```bash
pnpm lint
pnpm typecheck
pnpm test         # unitários (Vitest)
pnpm test:e2e     # e2e (Playwright, desktop e mobile)
pnpm build
```

## Estado atual

Fase 0 (fundação): layout responsivo com identidade visual e telas provisórias.
Fase 1A-1: banco no Supabase (dev) com Drizzle, migrações e RLS aplicada.
Fase 1A-2: login com 2FA, sessão, perfis (RBAC) e proteção das telas. Veja `docs/STATUS.md`.

> Antes de publicar em produção faltam CSP e limite de tentativas de login (1A-3).
