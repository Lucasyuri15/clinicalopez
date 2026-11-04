# STATUS — estado atual e próximo passo

> Leia este arquivo ao começar uma sessão nova (ex.: em outro computador). Atualize-o ao fim de cada etapa.
> **Última atualização:** 2026-11-04 · Regras de trabalho: `AGENTS.md` · Requisitos: `docs/PRD.md`

## Onde estamos
- **Fase 0 (fundação) concluída e mergeada na `dev`** (PR #1). Entregou: Next.js 16 + pnpm, Tailwind/shadcn, identidade visual (amarelo `#F7CB2C`), layout responsivo com telas provisórias, utilitários de moeda e data (com TDD), cabeçalhos de segurança/`noindex`, testes Vitest + Playwright.
- **Ainda não existem:** login, banco de dados, Supabase conectado ao código, ORM. Nada disso foi feito de propósito na Fase 0.
- **A `main` só tem a documentação inicial, de propósito.** Não fazer merge da `dev` na `main` antes do login da Fase 1: as telas não têm autenticação e o domínio de produção é público.

## Infraestrutura (já criada pelo usuário)
| Item | Situação |
|---|---|
| GitHub | `github.com/Lucasyuri15/clinicalopez` · branches `main` (produção) e `dev` (testes). PRs sempre para a `dev`. |
| Vercel | Projeto `clinicalopez` importado do GitHub. Framework Preset = **Next.js** (estava em *Other* e dava 404). Production = `main` (hoje 404 em `clinicalopez.vercel.app`, esperado). Branches `dev` e `feat/*` geram **Preview**, protegido por login da Vercel. Plano **Hobby**; o usuário aceitou o uso interno (os termos do Hobby falam em uso não comercial: risco assumido por ele, trocar para Pro se necessário). |
| Supabase **dev** | Projeto com ID `ccugjgpbprxhdwtvemll` (API: `https://ccugjgpbprxhdwtvemll.supabase.co`), plano **Free**, região São Paulo. **Confirmar** que "Enable automatic RLS" ficou marcada e "Automatically expose new tables" desmarcada. |
| Supabase **produção** | **Ainda não criado.** Decisão pendente: pagar o Pro (backups automáticos) ou ficar no Free com backup nosso + aviso de risco. Pode esperar até antes de entrarem dados reais de pacientes. |

## Próximo passo (NÃO esquecer)
**Planejar a Fase 1A em plan mode** (regra do `AGENTS.md` para mudanças grandes), a partir da `dev` atualizada:

```bash
git switch dev && git pull
git switch -c feat/fase-1a-acesso-dados
```

Escopo proposto da **1A — Acesso e dados** (validar com o usuário antes de implementar; começar pelo fluxo de brainstorming do `AGENTS.md`, uma pergunta por vez):
1. Conexão com o Supabase (variáveis de ambiente, cliente servidor/navegador).
2. ORM (Drizzle ou Prisma) e migrações versionadas, incluindo políticas de RLS em SQL.
3. Login (Supabase Auth) com **2FA (TOTP)** obrigatório para admin e profissionais; sem cadastro público (usuários criados pelo admin).
4. Perfis `admin`, `reception`, `professional` (RBAC no servidor + RLS).
5. CSP completa, limite de tentativas de login, ambientes dev/prod separados.
6. Decidir se a Data API do Supabase será desligada (o app acessa o banco pelo servidor).

Depois, **1B — Cadastros:** pacientes, profissionais (grade de horários), serviços, convênios, usuários.

## Regras que valem sempre (resumo)
- **Nunca** pedir/aceitar no chat a chave `service_role`/*secret* do Supabase, a senha do banco ou a connection string. O usuário cola esses valores direto em `.env.local` e nas variáveis da Vercel. A *publishable key* (`sb_publishable_…`) e a URL são públicas.
- Variáveis na Vercel separadas por ambiente: **Preview → Supabase dev**, **Production → Supabase prod**.
- Plan mode para mudanças grandes; TDD; verificar com `pnpm lint && pnpm typecheck && pnpm test` (+ `pnpm test:e2e` em mudanças de UI) antes de dizer que terminou.
- Commit/push e PR somente quando o usuário pedir. Idioma: conversa e UI em pt-BR; código e commits em inglês.

## Para retomar em outro computador
```bash
git clone https://github.com/Lucasyuri15/clinicalopez.git && cd clinicalopez
git switch dev && git pull
npm install -g pnpm                      # o corepack não vem no Node recente
pnpm install
pnpm exec playwright install chromium    # uma vez
gh auth login && gh auth setup-git       # para push/PR
git config user.name "Lucas Yuri" && git config user.email "<seu e-mail do GitHub>"
pnpm dev                                 # http://localhost:3000
```
Requer Node 20.9+ (a máquina original usa Node 26). O `.env.local` **não** vai para o Git: recrie-o em cada máquina quando a Fase 1A pedir.

## Pendências do PRD (não bloqueiam a 1A)
- Logo original em SVG (hoje PNG 640×640 em `docs/brand/` e `public/brand/`).
- WhatsApp automático: CNPJ e número dedicado para a API oficial da Meta.
- Domínio próprio, backup externo criptografado, escolha do plano Supabase de produção.
- Itens adiados por falta de dados: duração/regras de horário dos serviços, convênios, retenção de prontuário, migração de dados.
