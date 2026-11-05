# STATUS — estado atual e próximo passo

> Leia este arquivo ao começar uma sessão nova (ex.: em outro computador). Atualize-o ao fim de cada etapa.
> **Última atualização:** 2026-11-05 · Regras de trabalho: `AGENTS.md` · Requisitos: `docs/PRD.md`

## Onde estamos
- **Fase 0 (fundação) concluída e mergeada na `dev`** (PR #1): Next.js 16 + pnpm, Tailwind/shadcn, identidade visual, layout responsivo com telas provisórias, utilitários de moeda e data, cabeçalhos de segurança/`noindex`, testes Vitest + Playwright.
- **Fase 1A-1 (banco, Drizzle e RLS) concluída na branch `feat/fase-1a-acesso-dados`** (ainda sem PR). Spec: `docs/specs/2026-11-05-fase-1a1-banco-rls.md`; plano: `docs/plans/2026-11-05-fase-1a1-banco-rls.md`. Entregou: conexão com o Supabase dev (`app_backend` pelo pooler), Drizzle + migrações versionadas, tabela `profiles` com RLS (admin vê/gerencia todos; os demais só o próprio perfil; ninguém apaga), `withUser` (único acesso a dados, assume `authenticated` + usuário), trava de `db:migrate` por projeto (estrita), regra ESLint contra o cliente cru, testes de RLS e de catálogo contra o dev. Revisada por subagente; achados importantes corrigidos (ver spec).
- **Ainda não existem:** login, 2FA, sessão, RBAC no servidor, usuários reais no Auth, CSP, limite de tentativas. As telas continuam sem autenticação.
- **A `main` só tem a documentação inicial, de propósito.** Não fazer merge da `dev` na `main` antes do login (1A-2): as telas não têm autenticação e o domínio de produção é público.

## Infraestrutura (já criada pelo usuário)
| Item | Situação |
|---|---|
| GitHub | `github.com/Lucasyuri15/clinicalopez` · branches `main` (produção) e `dev` (testes). PRs sempre para a `dev`. |
| Vercel | Projeto `clinicalopez` importado do GitHub. Framework Preset = **Next.js** (estava em *Other* e dava 404). Production = `main` (hoje 404 em `clinicalopez.vercel.app`, esperado). Branches `dev` e `feat/*` geram **Preview**, protegido por login da Vercel. Plano **Hobby**; o usuário aceitou o uso interno (os termos do Hobby falam em uso não comercial: risco assumido por ele, trocar para Pro se necessário). |
| Supabase **dev** | Projeto com ID `ccugjgpbprxhdwtvemll` (API: `https://ccugjgpbprxhdwtvemll.supabase.co`), plano **Free**, região São Paulo. **Migrações 0000–0002 aplicadas** (`profiles`, enum `user_role`, schema `app`, função `app.current_app_role()`, papel `app_backend` com timeouts, 4 políticas de RLS, privilégios padrão sem grants para `anon`/`authenticated`). Conexões: `DATABASE_URL` = Transaction pooler (6543, `app_backend.<ref>`); `DIRECT_URL` = **Session pooler** (5432, `postgres.<ref>`) porque a conexão direta é só IPv6. A senha de `app_backend` foi gerada localmente e está só no `.env.local` de **cada máquina**. |
| Supabase **produção** | **Ainda não criado.** Decisão pendente: pagar o Pro (backups automáticos) ou ficar no Free com backup nosso + aviso de risco. Pode esperar até antes de entrarem dados reais de pacientes. |

## Próximo passo (NÃO esquecer)
1. **Integrar a 1A-1:** abrir PR de `feat/fase-1a-acesso-dados` para a `dev` (o usuário faz o merge). Depois: `git switch dev && git pull`.
2. **Planejar a 1A-2 (Login, 2FA e perfis) em plan mode** (regra do `AGENTS.md` para mudanças grandes), numa branch nova (ex.: `feat/fase-1a2-login`), começando pelo brainstorming (uma pergunta por vez). Escopo proposto:
   - Supabase Auth com `@supabase/ssr` (cliente servidor/navegador; só a URL e a *publishable key* são públicas), sessão por cookie e `proxy.ts` para checagem otimista (a autorização real fica no servidor, via `withUser`).
   - **2FA TOTP** obrigatório para admin e profissionais (recepção recomendado); política de recuperação de acesso.
   - RBAC no servidor usando `app.current_app_role()` + proteção de todas as telas e ações; sem cadastro público.
   - **Criação de usuários pelo admin**: exige a chave *secret* do Supabase **somente no servidor** (nunca `NEXT_PUBLIC_`, nunca no chat). Decidir se usa a Admin API do Auth ou convite por e-mail.
   - Seed de DEV (`pnpm db:seed`) com usuários fictícios, bloqueado fora do dev.
3. **1A-3 (endurecimento):** CSP com nonce, limite de tentativas de login, variáveis na Vercel (Preview → dev, Production → prod), decidir se desliga a Data API (o app acessa o banco pelo servidor).

Depois, **1B — Cadastros:** pacientes, profissionais (grade de horários), serviços, convênios, usuários.

## Regras que valem sempre (resumo)
- **Nunca** pedir/aceitar no chat a chave `service_role`/*secret* do Supabase, a senha do banco ou a connection string. O usuário cola esses valores direto em `.env.local` e nas variáveis da Vercel. A *publishable key* (`sb_publishable_…`) e a URL são públicas.
- Variáveis na Vercel separadas por ambiente: **Preview → Supabase dev**, **Production → Supabase prod**. Na Vercel vai **só** `DATABASE_URL` (papel `app_backend`); `DIRECT_URL` e `MIGRATION_PROJECT_REF` ficam só nas máquinas de desenvolvimento.
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
Requer Node 20.9+ (a máquina original usa Node 26).

**`.env.local` em outra máquina** (não vai para o Git): crie a partir do `.env.example` com `DATABASE_URL`, `DIRECT_URL` e `MIGRATION_PROJECT_REF` (ref do projeto dev: `ccugjgpbprxhdwtvemll`). A senha de `app_backend` só existe no `.env.local` da máquina original: ou copie o arquivo por um meio seguro (gerenciador de senhas), ou defina uma nova no **SQL Editor** do Supabase (`alter role app_backend with password '<nova senha forte>'`) e atualize a `DATABASE_URL` (usuário `app_backend.<ref>`) nas máquinas. Sem o `.env.local`, os testes de integração do banco são pulados e o app não conecta ao banco.

## Pendências do PRD (não bloqueiam a 1A-2)
- Logo original em SVG (hoje PNG 640×640 em `docs/brand/` e `public/brand/`).
- WhatsApp automático: CNPJ e número dedicado para a API oficial da Meta.
- Domínio próprio, backup externo criptografado, escolha do plano Supabase de produção.
- Itens adiados por falta de dados: duração/regras de horário dos serviços, convênios, retenção de prontuário, migração de dados.
