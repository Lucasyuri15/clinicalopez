# AGENTS.md — López + Saúde

Sistema interno de agendamentos e gestão para a clínica familiar López + Saúde
(Fisioterapia, Odontologia, Psicologia). Requisitos completos em `docs/PRD.md` — leia antes de mudanças de escopo.

**Ao começar uma sessão, leia `docs/STATUS.md`:** ele traz o estado atual, a infraestrutura criada e o próximo passo.

## Stack
**Instalado (Fase 0):** Next.js 16 (TypeScript strict, App Router; **sem** Cache Components/PPR: todas as rotas são renderizadas por requisição, exigência da CSP com nonce) · Tailwind 4 · shadcn/ui (Base UI) · Vitest · Playwright · pnpm.
**Instalado (Fase 1A-1):** **Drizzle ORM** + driver `postgres` · **Zod** · `server-only` · banco no **Supabase** (projeto dev) com RLS aplicada.
**Instalado (Fase 1A-2):** **Supabase Auth** (`@supabase/ssr`, `@supabase/supabase-js`) com login por senha + **2FA TOTP obrigatório para todos**, `src/proxy.ts`, RBAC · `tsx` (scripts locais) e `otpauth` (só testes).
**Instalado (Fase 1A-3, em andamento):** **CSP com nonce** gerada no `src/proxy.ts` (`src/lib/security/csp.ts`; `script-src` sem `unsafe-inline`; `img-src data:` só para o QR do 2FA).
**Instalado (Fase 1A-3):** limite de tentativas próprio (login e 2FA, por IP real e e-mail+IP; tabela `auth_attempts` só acessível por funções SQL) · **timeout de inatividade de 30 min** (cookie `ls_activity` gerido só pelo `src/proxy.ts`; regras em `src/lib/auth/inactivity.ts`).
**Planejado:** ajustes do pool, guarda de variáveis por ambiente e checklist de produção (resto da 1A-3) · deploy na **Vercel** · Storage (Fase 4).

> O Next.js desta versão tem mudanças de API: antes de escrever código de framework, consulte `node_modules/next/dist/docs/` (veja o bloco ao final deste arquivo). Se um comando abaixo ainda não existir, crie-o em vez de inventar alternativa e mantenha esta seção atualizada.

## Comandos
```bash
pnpm install                 # instala dependências
pnpm dev                     # app em http://localhost:3000
pnpm build && pnpm start     # build e execução de produção local

pnpm lint                    # ESLint
pnpm typecheck               # next typegen && tsc --noEmit
pnpm test                    # unitários/componentes (Vitest, jsdom)
pnpm test:e2e                # fluxos completos (Playwright: desktop e mobile; sobe o `pnpm dev`). Usa o Supabase DEV com usuários fictícios (criados e apagados pelo projeto `setup`/`cleanup`); SEM `.env.local` completo é pulado

pnpm db:generate             # gera migração a partir do schema (use --custom para SQL à mão: RLS, grants, funções)
pnpm db:migrate              # aplica migrações via DIRECT_URL; RECUSA se o projeto não for o de MIGRATION_PROJECT_REF
pnpm users:link <e-mail> <admin|reception|professional> "<Nome>"   # vincula o papel a um usuário criado no painel do Supabase (dono do banco)
pnpm users:reset-mfa <e-mail> [--yes]   # recuperação de 2FA (celular perdido): remove fatores e sessões; sem --yes só simula

# Ainda NÃO existem:
pnpm db:seed                 # dados FICTÍCIOS, somente no ambiente de DEV (previsto na 1B, com os cadastros)
pnpm backup                  # exporta banco + anexos criptografados (ver PRD, seção 5)
```
**Antes de dizer que terminou:** `pnpm lint && pnpm typecheck && pnpm test` devem passar. Mudanças de fluxo/UI: rode também `pnpm test:e2e` e confira no navegador (desktop e celular).

**Testes de integração do banco** (`src/server/db/*.test.ts`) rodam contra o Supabase **dev** usando o `.env.local`, em transações sempre revertidas e só com dados fictícios. Sem `.env.local` eles são **pulados** (a suíte continua verde). Eles recusam rodar fora do projeto de `MIGRATION_PROJECT_REF`.

**Variáveis (`.env.local`, modelo em `.env.example`):** `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (públicas), `DATABASE_URL` (Transaction pooler, porta 6543, usuário `app_backend.<ref>`), `DIRECT_URL` (Session pooler, porta 5432, usuário `postgres.<ref>`; a conexão direta do plano Free é só IPv6) e `MIGRATION_PROJECT_REF`. A senha de `app_backend` é gerada fora do Git, **nunca** vai em migração, chat ou commit. Na Vercel configure **somente** as duas variáveis públicas e `DATABASE_URL`: `DIRECT_URL` (dono `postgres`) e `MIGRATION_PROJECT_REF` não vão para o app. O app recusa iniciar se `DATABASE_URL` não usar o papel `app_backend`.

## Estrutura (alvo)
```
src/app/            rotas e telas (App Router); (app)/ = telas com o shell da clínica
src/components/     layout/ (shell, menu), ui/ (shadcn), componentes reutilizáveis
src/lib/            utilitários puros: money (BRL em centavos), datetime (Brasília), navigation (menu)
src/test/           setup do Vitest
e2e/                testes Playwright (*.spec.ts)
docs/               PRD, specs/ e plans/; docs/brand/ identidade visual

src/server/         código só de servidor (`import "server-only"`): env.ts (variáveis validadas com Zod)
src/server/db/      schema.ts, migrations/ (SQL versionado), client.ts (cliente cru, PRIVADO),
                    with-user.ts (`withUser`: único acesso a dados), migration-guard.ts, admin-users.ts, testes de RLS
src/server/auth/    session.ts (DAL: requireUser/requireRole/requirePageAccess), actions.ts (Server Actions
                    de login/2FA/logout), mfa-step.ts, step-gate.tsx
src/lib/auth/       access.ts (matriz de acesso por tela), route-guard.ts, steps.ts, schemas.ts, qr.ts (puros, testados)
src/lib/supabase/   env.ts (variáveis públicas), server.ts (cliente por requisição), proxy.ts (renovação de sessão)
src/proxy.ts        checagem OTIMISTA de sessão em todas as rotas (só JWT, sem banco)
scripts/            comandos locais do dono do banco (users:link, users:reset-mfa)
drizzle.config.ts   config do drizzle-kit (usa DIRECT_URL e a trava de projeto)

# Previsto:
src/server/storage/ interface de anexos (driver Supabase Storage / S3 no futuro)
```

## Convenções
- **Idioma:** UI, mensagens e textos em **pt-BR**; código, identificadores e commits em **inglês**.
- **TypeScript strict**; sem `any` (use `unknown` + validação). Validação de entrada com **Zod** em toda fronteira (forms, actions, API).
- **Autorização no servidor** (camada única de acesso a dados em `src/server`) **e** reforçada por **RLS** no Supabase, com as políticas versionadas em migrações SQL. Perfis: `admin`, `reception`, `professional`. Recepção nunca lê prontuário; profissional só os próprios pacientes; admin acessa tudo. Todo acesso a prontuário gera log de auditoria.
- **Auth:** Supabase Auth, login por senha + **2FA TOTP obrigatório para TODOS os perfis**; sem cadastro público (desligado no painel). Usuários são criados no **painel do Supabase** e o papel vinculado com `pnpm users:link` (nenhuma chave *secret* no app). Só o `src/proxy.ts` renova o token **e aplica o timeout de inatividade (30 min)**; Server Components/Actions apenas leem a sessão (`getClaims`, nunca `getSession` no servidor). Sem "esqueci minha senha" por e-mail por ora (reset pelo painel).
- **Proteção de telas e ações:** o `proxy` é só uma checagem otimista. **Toda** página do grupo `(app)`, Server Action e Route Handler não público chama `requirePageAccess(rota)`/`requireUser()`/`requireRole(...)` (`@/server/auth/session`); o layout NÃO basta (não re-renderiza a cada navegação). Tela nova: registre-a em `src/lib/auth/access.ts` (rota desconhecida é negada) e teste por papel. Ler sessão (cookies) dentro de `<Suspense>` (boa prática de streaming; o build não exige mais). **Não ligar `cacheComponents`/`partialPrefetching`** e manter `await connection()` no layout raiz: um shell estático não recebe o nonce da CSP e o React deixa de hidratar (medido; guardado por `src/lib/security/dynamic-rendering.test.ts`). Dado de paciente/agenda nunca em cache compartilhado.
- **Datas:** salvar em UTC; exibir em `America/Sao_Paulo`. **Dinheiro:** inteiro em centavos, formatar em BRL só na exibição.
- **Banco:** toda alteração via migração versionada; nunca editar migração já aplicada. Exclusão de dados clínicos é lógica (soft delete) com auditoria.
- **Acesso a dados (RLS de verdade):** o app conecta como `app_backend` (sem BYPASSRLS, sem privilégios próprios) e **todo** acesso passa por `withUser({ userId }, async (tx) => …)` de `@/server/db/with-user`, que assume o papel `authenticated` com o usuário logado. **Nunca** importe `@/server/db/client` fora de `src/server/db/` (regra ESLint). Toda tabela nova: `.enableRLS()` no schema, `REVOKE` de `anon`/`PUBLIC`, `GRANT` mínimo a `authenticated`, políticas em migração SQL **e uma política `RESTRICTIVE` exigindo `aal2`** (modelo: migração `0003_require_aal2.sql`; a URL e a chave publishable são públicas e a Data API aceita um JWT só de senha, então a RLS também exige o 2FA; o teste de catálogo falha se faltar), **com teste de RLS por perfil** (modelo: `rls.test.ts`). O papel do usuário vem de `app.current_app_role()` (lê `profiles`), não do JWT.
- **Agenda:** conflito de horário (profissional e paciente) é checado no servidor e protegido por constraint/transação no banco, não só na UI.
- **Portabilidade (PRD 6.1):** configuração só por variáveis de ambiente (`.env`, mantenha `.env.example` atualizado); anexos pela interface de storage; jobs como rotas HTTP protegidas por segredo (Vercel Cron); evite recursos exclusivos da Vercel quando houver alternativa padrão.
- **Ambientes:** produção (dados reais) e dev/preview (projeto Supabase separado). Dados reais só em produção.
- **UI:** mobile-first e acessível (WCAG AA). Cores e fontes só via tokens do tema (marca: amarelo `#F7CB2C`, medido na logo, + preto `#111111`; texto preto sobre amarelo; token `--brand` em `src/app/globals.css`). Cores de status separadas da cor de marca.
- **Testes:** obrigatórios para regras de conflito de agenda, recorrência, permissões (RBAC) e cálculo financeiro. Teste novo ao corrigir bug.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`…), pequenos e focados.
- Prefira código simples e dependências já presentes; justifique qualquer biblioteca nova.

## Fluxo de trabalho
Adaptado do workflow do projeto [Superpowers](https://github.com/obra/superpowers) (só a metodologia; o plugin não é dependência).

**Classifique antes de agir:**
- **Pequena** (bug localizado, texto/estilo, teste): faça direto, seguindo os passos 5 a 7.
- **Grande:** nova fase/módulo do PRD, schema ou migração, auth/RBAC/RLS, prontuário e anexos, WhatsApp, backup/infra, refactor em muitos arquivos, qualquer decisão que mude o PRD. Use **plan mode** e siga todos os passos, só implementando após aprovação.

**Passos (mudança grande):**
1. **Entender e questionar (brainstorming).** Antes de qualquer código, leia o que já existe (PRD, código, docs) e não pergunte o que já está respondido. Devolva com suas palavras o que entendeu e o porquê. Faça **uma pergunta por vez**, a de maior impacto. Se algo não for óbvio, apresente 2–3 abordagens com prós e contras e uma recomendação, e espere a escolha.
2. **Design aprovado.** Registre a decisão em `docs/specs/AAAA-MM-DD-<tema>.md` (curto se for pequeno) e obtenha aprovação antes de planejar. Se mudar o PRD, atualize `docs/PRD.md` na mesma entrega.
3. **Ambiente isolado.** Trabalhe numa branch própria (git worktree, se possível). Rode a suíte antes de começar para ter uma base verde.
4. **Plano em tarefas pequenas.** Salve em `docs/plans/AAAA-MM-DD-<tema>.md`. Cada tarefa: 2–5 minutos, caminhos exatos de arquivos, interfaces/assinaturas, o teste que a prova e o comando de verificação. Princípios: **YAGNI** e **DRY**. Plano com vários subsistemas independentes vira vários planos.
5. **Executar tarefa a tarefa com TDD.** Ciclo **RED → GREEN → REFACTOR**: escreva o teste, **veja-o falhar pelo motivo certo**, escreva o mínimo para passar, veja passar, refatore. *Sem código de produção sem um teste falhando antes*; se escreveu código antes do teste, descarte e refaça. Exceções (confirme com o usuário): protótipo descartável, código gerado, configuração e ajuste puramente visual.
6. **Revisão a cada tarefa.** Peça revisão a um subagente com contexto enxuto (descrição, requisitos, diff), não com todo o histórico da sessão. Corrija o que for **crítico** e **importante** antes de seguir; registre os menores. Se o revisor estiver errado, responda com argumento técnico e teste. Tarefa grande ou sensível (RBAC, financeiro, migração): revisão obrigatória; revisão final da branch antes de integrar.
7. **Verificação antes de afirmar sucesso.** *Nenhuma afirmação de conclusão sem evidência recente.* Rode os comandos completos nesta mesma resposta (`pnpm lint`, `typecheck`, `test`, e `test:e2e` se mexeu em fluxo/UI), leia a saída e o código de saída, e só então declare. Proibido "deve funcionar", "provavelmente" ou comemorar antes de verificar. Se delegou a um subagente, confira você mesmo o diff.
8. **Finalizar a branch.** Com a suíte verde, apresente as opções ao usuário: (1) integrar localmente na branch base, (2) abrir Pull Request, (3) manter a branch. Confirme a branch base antes de mesclar. Descartar trabalho só se o usuário pedir explicitamente.

**Depurando:** investigue a **causa raiz** antes de corrigir (reproduza, leia o erro completo, rastreie a origem, compare com código que funciona, teste uma hipótese por vez). Nada de "chutar" correções; todo bug corrigido ganha um teste de regressão que falhou antes da correção.

**Regras gerais**
- Commit/push somente quando o usuário pedir. Ao aprovar um plano, o usuário pode autorizar commits por tarefa (Conventional Commits).
- Nunca confie cegamente em relatório de subagente; verifique no diff e rodando os comandos.
- Não misture mudanças não relacionadas na mesma entrega.

## Proibições
- **Nunca** usar dados reais de pacientes em código, testes, seeds, fixtures, prints ou logs. Só dados fictícios.
- **Nunca** commitar segredos (`.env`, tokens do WhatsApp/Meta, chaves de backup) nem logar dados de saúde ou PII (CPF, telefone, prontuário).
- **Nunca** contornar ou duplicar a checagem de permissões, nem criar rota/endpoint sem autorização.
- **Nunca** criar rota pública, desativar RLS, usar a chave `service_role`/*secret* do Supabase no cliente/browser ou prefixar segredos com `NEXT_PUBLIC_`. As **únicas** variáveis `NEXT_PUBLIC_` permitidas são `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (públicas por natureza; ver `src/lib/supabase/env.ts`).
- **Nunca** apontar `pnpm dev`, testes, seeds ou migrações experimentais para o banco de **produção**.
- **Nunca** rodar comandos destrutivos (`drop`, `truncate`, `rm -rf`, reset de banco) sem confirmação explícita do usuário e backup prévio.
- **Nunca** editar migrações já aplicadas, nem apagar registros clínicos de forma física.
- **Nunca** fixar URLs/caminhos/regiões no código nem criar dependência de recursos exclusivos da Vercel sem necessidade.
- **Nunca** deixar o site ser indexado por buscadores (manter `noindex`).
- **Nunca** usar texto amarelo sobre fundo branco (contraste insuficiente).
- **Nunca** adicionar telemetria/analytics ou enviar dados a serviços externos sem aprovação.
- Não implementar itens fora do escopo do MVP (autoagendamento, TISS/nota fiscal, teleconsulta, app nativo, odontograma) sem alteração prévia do PRD.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
