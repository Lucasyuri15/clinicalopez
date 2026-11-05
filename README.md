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

O app acessa o banco só pelo servidor, sob RLS, via `withUser` (ver `AGENTS.md`).
Sem `.env.local`, os testes de integração do banco são pulados.

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
Ainda **sem login**; ele entra na 1A-2. Veja `docs/STATUS.md` para o estado detalhado.

> **Não publique esta versão em produção.** As telas não exigem autenticação; o deploy
> de produção só deve acontecer depois do login (1A-2).
