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
Ainda **sem login e sem banco de dados**; eles entram na Fase 1, quando os projetos
Vercel e Supabase estiverem criados.

> **Não publique esta versão na internet.** As telas não exigem autenticação; o deploy
> só deve acontecer depois do login da Fase 1.
