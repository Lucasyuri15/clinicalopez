# Plano — Fase 1A-3: endurecimento

## Contexto
A 1A-2 entregou login + 2FA + RBAC, mas a `main` segue sem o app de propósito até que existam CSP, limite de tentativas próprio e as decisões de sessão. A revisão da 1A-2 deixou riscos registrados em `docs/specs/2026-11-06-fase-1a2-login-2fa.md` (#4 limites do Supabase por IP da Vercel; #6 JWT `aal2` vale até o `exp`; #11 lacunas de teste). Esta fase fecha esses itens. O projeto Supabase de **produção fica fora** (decisão do usuário: decidir depois): a `main` continua sem o app e o STATUS mantém essa trava.

Branch: `feat/fase-1a3-endurecimento` (já criada, em dia com a origem). Fluxo: spec em `docs/specs/2026-11-0X-fase-1a3-endurecimento.md` → plano em `docs/plans/` → TDD por tarefa → revisão por subagente (RBAC/auth é sensível: obrigatória) → verificação.

## Decisões já tomadas com o usuário
| Tema | Decisão |
|---|---|
| CSP | **Nonce** gerado no `proxy`, `script-src 'nonce-…' 'strict-dynamic'`, sem `unsafe-inline` em scripts; `img-src 'self' data: blob:` (QR do 2FA). Todas as rotas viram dinâmicas (sem shell estático). |
| Contadores do limite | **Tabela no Postgres**, acesso só por funções SQL (usuário ainda não logado); sem serviço externo. |
| Regra de bloqueio | **Por IP** (teto geral) **e por e-mail+IP** (teto menor), com **atraso crescente**. Sem bloqueio de conta (evita travar o admin de propósito). Contador global por e-mail só para alerta, sem bloquear. |
| Inatividade | **30 min** (teto absoluto de 8 h do cookie continua). |
| Supabase prod | **Decidir depois**; passo manual pendente documentado. |

Decisões técnicas sem alternativa real (a confirmar na revisão do plano): pool, variáveis Vercel, JWT 30 min no painel.

## Tarefas (ordem de execução)

### T0 — Spike do nonce com Cache Components — FEITO (2026-11-07)
Resultado completo na spec. Com `cacheComponents` + `partialPrefetching` o nonce **não funciona** (11 de 26 scripts sem nonce, 11 violações de CSP, React não hidrata). O usuário aprovou **desligar `cacheComponents` e `partialPrefetching`**. Repetido o spike assim, com o layout raiz dinâmico (`await connection()`): 21 de 21 scripts com nonce, 0 violações, hidratado. Protótipos descartados (árvore limpa).

### T1 — CSP com nonce (inclui desligar o cacheComponents)
- `next.config.ts`: **remover** `cacheComponents`, `partialPrefetching` e o bloco `experimental.instantInsights` (e o comentário dele). Atualizar a linha "Stack" do `AGENTS.md` (já não é "Cache Components") e o comentário sobre `<Suspense>` na convenção "Proteção de telas e ações" (a leitura de sessão em `<Suspense>` segue como boa prática, mas o build deixa de exigir).
- `src/app/layout.tsx`: tornar o layout raiz `async` com `await connection()` (de `next/server`) para que **toda** rota, inclusive `/login` (que não lê cookies), seja dinâmica e receba nonce. Teste que falha se o layout raiz deixar de forçar renderização dinâmica (as rotas não podem voltar a ser estáticas sem aviso).
- Novo `src/lib/security/csp.ts` (puro, testado): `buildCsp({ nonce, isDev })` e `generateNonce()`. Diretivas: `default-src 'self'`, `script-src 'self' 'nonce-…' 'strict-dynamic'` (+ `'unsafe-eval'` só em dev), `style-src 'self' 'nonce-…'` (dev: `'unsafe-inline'`), `img-src 'self' blob: data:`, `font-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `upgrade-insecure-requests`. Atributos `style=""` inline (shadcn/Base UI) podem exigir `style-src-attr`: decidir pelos testes e2e, não no escuro.
- `src/proxy.ts`: gerar o nonce e pôr o `Content-Security-Policy` na **requisição** (o Next extrai o nonce dali; sem cabeçalho `x-nonce`, que nada no app consumiria) e na **resposta**; também nos redirects. Matcher atual já ancorado; manter.
- `next.config.ts`: manter os demais cabeçalhos; remover o comentário "CSP entra na fase de autenticação".
- Testes: unitário de `buildCsp` (sem `unsafe-inline` em `script-src` em produção; nonce único por chamada; `data:` só em `img-src`); `src/proxy.test.ts` (cabeçalho presente em next e em redirect); e2e em `e2e/security.spec.ts`: CSP presente, **zero violações no console** em login, `/mfa/enroll` (QR aparece) e `/dashboard`, desktop e mobile.

### T2 — Limite de tentativas próprio (por IP e e-mail+IP)
- **Migração** `0004_login_rate_limit.sql` (custom, via `pnpm db:generate --custom`): tabela `public.auth_attempts` (`id`, `kind` login|mfa, `ip`, `email_hash` = SHA-256 do e-mail normalizado, `user_id` nulo, `created_at`), `.enableRLS()` no schema, `REVOKE` de `anon`/`PUBLIC`/`authenticated`, **sem política** (ninguém lê pela Data API). Funções `SECURITY DEFINER` com `search_path` fixo, `EXECUTE` só para `app_backend`: `app.rate_limit_check(kind, ip, email_hash)` → `{allowed, retry_after_s}`; `app.rate_limit_record_failure(...)`; `app.rate_limit_reset(email_hash, ip)` (no sucesso). Limpeza de linhas > 24 h feita de forma oportunista dentro de `record_failure` (YAGNI: sem cron).
- **Acesso**: como o usuário ainda não está logado, não cabe em `withUser`. Novo módulo dentro de `src/server/db/` (`rate-limit.ts`), único lugar que chama as funções pelo cliente cru, respeitando a regra ESLint. Registrar a exceção no teste de catálogo (tabela sem grant a `authenticated`).
- **Regra** (constantes em `src/lib/auth/rate-limit-policy.ts`, pura e testada): janela 15 min; par e-mail+IP: 5 falhas → espera 1 min, 8 → 5 min, 10 → 15 min; IP: 20 falhas → mesma escala; e-mail global: apenas contagem para log de alerta (sem PII no log, só hash).
- **IP real**: `src/server/auth/client-ip.ts` lê `x-real-ip`/`x-forwarded-for` (na Vercel são definidos pela plataforma). Cabeçalho configurável por variável de ambiente para portabilidade (`CLIENT_IP_HEADER`, atualizar `.env.example` e `src/server/env.ts`). Sem IP → usa balde `unknown` (falha fechada para o balde, não para o login).
- **Ações**: `src/server/auth/actions.ts` — `login`, `verifyMfaLogin` e `verifyMfaEnroll` chamam `check` **antes** do Supabase, `record_failure` no erro, `reset` no sucesso. Bloqueado → mesma mensagem `rateLimited` existente (sem dizer se o e-mail existe).
- Testes: unitários da política; ações com mock (bloqueia antes de chamar o Supabase, mensagem genérica, reset no sucesso); **teste de integração no banco dev** (`src/server/db/rate-limit.test.ts`, transação revertida, dados fictícios): escalonamento, janela, reset, IP A não bloqueia IP B, `authenticated` e `anon` **não** executam as funções nem leem a tabela.

### T3 — Sessão: JWT curto e timeout de inatividade
- **Painel (passo manual do usuário)**: JWT expiry 1800 s (campo ainda não localizado; se não achar, o teto passa a ser a inatividade + cookie de 8 h). **NÃO apertar** Authentication → Rate Limits (login e MFA): corrigido após a revisão do T2, pois todo o tráfego do app sai por poucos IPs da Vercel e apertar aproxima o teto do balde compartilhado (ver a spec, achado #2).
- `src/proxy.ts` + novo `src/lib/auth/inactivity.ts` (puro): cookie `HttpOnly`/`Secure` com a hora da última atividade, atualizado em navegações reais (ignorar prefetch e assets). Passou de 30 min → `signOut({ scope: "local" })`, apaga cookies e redireciona a `/login`. Reaproveitar `finalizeCookieOptions` (`src/lib/supabase/cookie-options.ts`).
- Limitação a registrar na spec: o cookie de atividade não é assinado; protege computador esquecido aberto, não cookie roubado (mitigado por `HttpOnly` + `Secure` + JWT curto). Constantes (30 min, 8 h) num só lugar.
- Testes: unitário do `inactivity.ts` (limite exato, relógio injetado); `proxy.test.ts` (expirado → login + cookies apagados; ativo → renova); e2e com relógio do Playwright avançado.

### T4 — Pool de conexões e variáveis por ambiente
- `src/server/db/client.ts`: manter `max: 5` por instância (o pooler em modo transação absorve; Free comporta ~200 clientes) e acrescentar `connect_timeout: 10` e `max_lifetime` (30 min). Justificar numa linha de comentário.
- Guarda nova em `src/server/env.ts`: o `ref` do projeto em `NEXT_PUBLIC_SUPABASE_URL` precisa ser o mesmo do usuário `app_backend.<ref>` da `DATABASE_URL`; senão falha ao iniciar. Evita Preview apontando a Auth de um projeto e o banco de outro. Teste unitário.
- `docs/STATUS.md` + `AGENTS.md`: tabela "variável × ambiente" (Preview → dev, Production → prod; só 2 públicas + `DATABASE_URL`; `CLIENT_IP_HEADER` opcional) e checklist manual de produção (criar projeto, desligar cadastro e Data API, TOTP, JWT, limites, `app_backend`).

### T5 — Pendências da revisão da 1A-2 (#11)
- `verifyMfaLogin` usa o primeiro fator verificado: aceitar só quando há exatamente um e tratar o caso contrário como erro genérico (teste).
- Teste de integração: DAL com perfil **inativo** contra o banco real (hoje só mock).
- e2e: chamar Server Action de 2FA com `aal1` fora do passo e ver o redirecionamento.
- **Adiado (registrar)**: `getUser()` em operações sensíveis (#6) só faz sentido quando existirem operações sensíveis (prontuário/1B+); anotar na spec.

### T6 — Documentação e fechamento
Spec da 1A-3 (decisões acima + resultado do spike), atualizar `docs/STATUS.md` (próximo passo = 1B; `main` segue sem o app até existir produção) e `AGENTS.md` (Stack: CSP e limite de tentativas instalados; novas variáveis; regra "tabela só por função" no item de acesso a dados). Sem commit/push até o usuário pedir.

## Arquivos críticos
`src/proxy.ts`, `src/lib/supabase/proxy.ts`, `src/lib/supabase/cookie-options.ts`, `src/server/auth/actions.ts`, `src/server/auth/mfa-step.ts`, `src/server/db/client.ts`, `src/server/db/catalog.test.ts`, `src/server/env.ts`, `next.config.ts`, `e2e/security.spec.ts`, migração `0004` (modelo: `0003_require_aal2.sql`).

## Verificação
- Por tarefa: teste falhando pelo motivo certo → passa (RED → GREEN).
- Final, nesta ordem e lendo a saída: `pnpm lint && pnpm typecheck && pnpm test`, depois `pnpm build` (nonce + Cache Components) e `pnpm test:e2e` (desktop e mobile, Supabase dev).
- Manual no navegador: login com senha errada várias vezes (atraso cresce, outro IP/e-mail não é afetado), console sem violações de CSP no cadastro do 2FA (QR visível), deslogar após 30 min parado.
- `pnpm db:migrate` só contra o dev (trava por `MIGRATION_PROJECT_REF`).
- Revisão por subagente da branch (auth/RLS/migração) antes de propor integração.

## Fora do escopo
Criar o Supabase de produção; "esqueci minha senha"; reuso de código TOTP (risco aceito na 1A-2); `getUser()` em operações sensíveis (adiado).
