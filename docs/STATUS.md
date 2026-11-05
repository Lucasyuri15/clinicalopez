# STATUS — estado atual e próximo passo

> Leia este arquivo ao começar uma sessão nova (ex.: em outro computador). Atualize-o ao fim de cada etapa.
> **Última atualização:** 2026-11-07 · Regras de trabalho: `AGENTS.md` · Requisitos: `docs/PRD.md`

## Onde estamos
- **Fase 0 (fundação) concluída e mergeada na `dev`** (PR #1): Next.js 16 + pnpm, Tailwind/shadcn, identidade visual, layout responsivo com telas provisórias, utilitários de moeda e data, cabeçalhos de segurança/`noindex`, testes Vitest + Playwright.
- **Fase 1A-1 (banco, Drizzle e RLS) concluída e mergeada na `dev`** (PR #3). Spec: `docs/specs/2026-11-05-fase-1a1-banco-rls.md`; plano: `docs/plans/2026-11-05-fase-1a1-banco-rls.md`. Entregou: conexão com o Supabase dev (`app_backend` pelo pooler), Drizzle + migrações versionadas, tabela `profiles` com RLS (admin vê/gerencia todos; os demais só o próprio perfil; ninguém apaga), `withUser` (único acesso a dados, assume `authenticated` + usuário), trava de `db:migrate` por projeto (estrita), regra ESLint contra o cliente cru, testes de RLS e de catálogo contra o dev. Revisada por subagente; achados importantes corrigidos (ver spec).
- **Fase 1A-2 (login, 2FA e perfis) concluída e mergeada na `dev`** (PR #4). Spec: `docs/specs/2026-11-06-fase-1a2-login-2fa.md`; plano: `docs/plans/2026-11-06-fase-1a2-login-2fa.md`. Entregou: login por senha + **2FA TOTP para todos**, `proxy.ts` (checagem otimista), DAL de sessão (`requireUser/requireRole/requirePageAccess`), matriz de acesso por tela (admin = tudo; recepção = Dashboard/Agenda/Pacientes/Financeiro; profissional = Dashboard/Agenda/Pacientes), menu por papel e "Sair", página `/sem-acesso`, comandos locais `users:link` e `users:reset-mfa`, e2e autenticados contra o Supabase dev. Revisada por subagente (ver spec).
- **Ainda não existem:** CSP, limite de tentativas de login próprio (só o do Supabase), cadastros (1B), tela de usuários no app. A `main` continua sem o app de propósito até a 1A-3.
- **A `main` só tem a documentação inicial, de propósito.** Não fazer merge da `dev` na `main` antes da 1A-3 (CSP e limite de tentativas) e de existir o Supabase de produção.

## Infraestrutura (já criada pelo usuário)
| Item | Situação |
|---|---|
| GitHub | `github.com/Lucasyuri15/clinicalopez` · branches `main` (produção) e `dev` (testes). PRs sempre para a `dev`. |
| Vercel | Projeto `clinicalopez` importado do GitHub. Framework Preset = **Next.js** (estava em *Other* e dava 404). Production = `main` (hoje 404 em `clinicalopez.vercel.app`, esperado). Branches `dev` e `feat/*` geram **Preview**, protegido por login da Vercel. Plano **Hobby**; o usuário aceitou o uso interno (os termos do Hobby falam em uso não comercial: risco assumido por ele, trocar para Pro se necessário). |
| Supabase **dev** | Projeto com ID `ccugjgpbprxhdwtvemll` (API: `https://ccugjgpbprxhdwtvemll.supabase.co`), plano **Free**, região São Paulo. **Migrações 0000–0002 aplicadas** (`profiles`, enum `user_role`, schema `app`, função `app.current_app_role()`, papel `app_backend` com timeouts, 4 políticas de RLS, privilégios padrão sem grants para `anon`/`authenticated`). Conexões: `DATABASE_URL` = Transaction pooler (6543, `app_backend.<ref>`); `DIRECT_URL` = **Session pooler** (5432, `postgres.<ref>`) porque a conexão direta é só IPv6. A senha de `app_backend` foi gerada localmente e está só no `.env.local` de **cada máquina**. **Auth:** cadastro público DESLIGADO ("Allow new users to sign up") e TOTP MFA habilitado (confirmados pelo usuário). |
| Supabase **produção** | **Ainda não criado.** Decisão pendente: pagar o Pro (backups automáticos) ou ficar no Free com backup nosso + aviso de risco. Pode esperar até antes de entrarem dados reais de pacientes. |

## Próximo passo (NÃO esquecer)
1. **Passos manuais (estado atual):**
   - ✅ **Feito:** primeiro admin criado no Supabase dev (e-mail fictício) e vinculado com `users:link`; 2FA cadastrado e testado à mão (login, código errado, senha errada, sair/entrar); variáveis de **Preview** na Vercel registradas (`NEXT_PUBLIC_SUPABASE_URL` e `..._PUBLISHABLE_KEY` como Config; `DATABASE_URL` como Secret); **Data API desligada** no Supabase dev.
   - ⏳ **Pendente:** reduzir a validade do JWT (o campo provavelmente está em Project Settings → JWT Keys; ainda não foi localizado) para 900–1800 s: um token `aal2` vale até expirar mesmo após logout/`reset-mfa`. Se não achar, tratar na 1A-3.
   - Mais usuários (recepção, profissionais) só no projeto de **produção**, com e-mails reais: Add user no painel + `pnpm users:link`. Cadastrar o 2FA logo após criar (entre a criação e o cadastro, quem souber a senha pode cadastrar o próprio autenticador).
   - **Perdeu o celular?** `pnpm users:reset-mfa <e-mail>` (simulação) e depois `--yes`; trocar a senha no painel antes de liberar o acesso. Recovery codes do Supabase são experimentais e **não** são usados. Esqueceu a senha: reset pelo painel (sem e-mail por ora).
   - Limitação conhecida (medida): o Supabase aceita o código TOTP da janela atual e de ±30 s, e aceita o **mesmo código mais de uma vez** na janela. Risco aceito (ver spec da 1A-2).
2. *(feito)* 1A-2 integrada na `dev` (PR #4).
3. **Planejar a 1A-3 (endurecimento) em plan mode**, na branch `feat/fase-1a3-endurecimento` (criada a partir da `dev`; nenhum código ainda), começando pelo brainstorming com uma pergunta por vez. Itens: CSP com nonce (liberar `img-src data:` para o QR do 2FA), **limite de tentativas próprio por e-mail e IP real** (os limites do Supabase Auth são por IP do servidor da Vercel e viram um balde compartilhado: um atacante pode dar 429 para todos), apertar o limite em Authentication → Rate Limits, timeout de inatividade, tamanho do pool de conexões, decidir se desliga a Data API do Supabase, variáveis da Vercel por ambiente (Preview → dev, Production → prod).
4. Depois, **1B — Cadastros:** pacientes, profissionais (grade de horários), serviços, convênios e, se ainda fizer sentido, tela de usuários dentro do app (exigiria a chave *secret* no servidor; decisão adiada).

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
