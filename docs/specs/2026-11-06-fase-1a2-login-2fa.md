# Spec — Fase 1A-2: login, 2FA e perfis

**Data:** 2026-11-06 · **Status:** aprovado pelo usuário (plan mode) · **Plano:** `docs/plans/2026-11-06-fase-1a2-login-2fa.md`

## Contexto
A 1A-1 entregou banco, RLS e `withUser`, mas todas as telas ainda são públicas. A 1A-2 coloca login por e-mail/senha com 2FA TOTP na frente de tudo, sessão por cookie, RBAC e proteção de telas/ações.

## Decisões do usuário
- **Usuários criados pelo painel do Supabase** (Authentication → Users → Add user). **Nenhuma chave *secret* no app.** Um comando local vincula o papel. A tela "Usuários" do app fica para a 1B.
- **2FA obrigatório para todos os perfis.**

## Decisões técnicas
- **Tudo por Server Actions**; sem cliente Supabase no navegador. Cliente de servidor (cookies) e helper do `proxy`.
- **Sessão:** `proxy.ts` renova a sessão com `getClaims()` (verifica a assinatura do JWT no JWKS) e faz só redirecionamento otimista (cookie/JWT, sem banco). A DAL (`src/server/auth/session.ts`) revalida com `getClaims()`, exige `aal2` e carrega o perfil via `withUser`. Nunca `getSession()` no servidor. Só o `proxy` renova o token (renovar em dois lugares desloga o usuário).
- **Cache Components:** sessão lida só dentro de `<Suspense>`; não confiar só no layout (ele não re-renderiza a cada navegação): `proxy` + checagem em cada página, ação e rota.
- **Erros de login genéricos** (sem enumeração de usuários); 429 vira "muitas tentativas".
- **Recuperação de 2FA:** os *recovery codes* do Supabase são experimentais (flag `auth.experimental.recoveryCodes`) e não serão usados. Recuperação = `pnpm users:reset-mfa <email>` (dono do banco, via `DIRECT_URL`, remove os fatores; o usuário cadastra de novo).
- **Sem "esqueci minha senha" por e-mail** (o e-mail padrão do Supabase é de 2/hora): reset pelo painel.
- **Matriz de acesso:** `admin` = tudo; `reception` = Dashboard, Agenda, Pacientes, Financeiro; `professional` = Dashboard, Agenda, Pacientes; Profissionais, Serviços e Configurações = só admin. Rota desconhecida = negada.
- **Variáveis públicas** `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (não são segredo) ficam num módulo próprio (`src/lib/supabase/env.ts`), separado do env do banco (`getServerEnv`), para o código de banco não depender delas. São as **únicas** com prefixo `NEXT_PUBLIC_`.
- **Limites do Supabase Auth** (docs oficiais): verificação MFA 15/min por IP (não configurável); login 150 por 5 min por IP (configurável; apertar na 1A-3).

## Fixtures de teste
Usuários fictícios criados por SQL em `auth.users` (e-mails `@teste.invalid`), com limpeza (apagar perfil e depois usuário; `sessions`/`mfa_factors`/`identities` têm `ON DELETE CASCADE`). O spike valida o método antes de construir.

## Resultado do spike
_A preencher após a tarefa 3._
