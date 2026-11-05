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
Executado em 2026-11-06 contra o projeto dev (script descartável, limpeza verificada: 0 resíduos):
- **Fixture por SQL funciona:** `auth.users` (com `instance_id` zerado, `encrypted_password` via `extensions.crypt(senha, extensions.gen_salt('bf'))`, `email_confirmed_at`, `raw_app_meta_data` com `provider: email` e **todas as colunas de token como string vazia**, nunca NULL) + `auth.identities` + `public.profiles` permitem `signInWithPassword` normalmente.
- **JWT:** assinado com **ES256** (assimétrico) ⇒ `getClaims()` verifica localmente pelo JWKS. Campos: `aal, amr, app_metadata, aud, email, exp, iat, is_anonymous, iss, phone, role, session_id, sub, user_metadata`. `amr` é uma lista de objetos com `method` (`password`, `totp`). `getClaims()` devolve `{ claims, header, signature }`.
- **Níveis (AAL):** sem fator: `aal1`/`aal1`. Após `enroll` + `challenge` + `verify` (código gerado com `otpauth`): `aal2`/`aal2`, `amr = ["totp","password"]`, e `getClaims()` já reflete `aal2` na mesma sessão. Logo `nextAuthStep`: `aal2` → app; `aal1` com `nextLevel=aal2` → verificar; `aal1` com `nextLevel=aal1` → cadastrar.
- **`mfa.enroll`** devolve `id`, `type`, `friendly_name` e `totp: { qr_code (data URI SVG), secret, uri }`; `listFactors` traz `status` por fator (permite achar fatores não verificados).
- **Plano B de fixture não foi necessário.**

## Revisão independente (subagente) e resposta
Revisão obrigatória (auth/RBAC). Achados e o que foi feito:
- **#1 IMPORTANTE, confirmado e corrigido (migração 0003):** a URL e a chave publishable são públicas e a Data API (PostgREST) aceita qualquer JWT de usuário. Provado no dev: um token só de senha (`aal1`) **lia o perfil de um admin** direto em `/rest/v1/profiles`, sem 2FA. Correção: política `RESTRICTIVE` exigindo `aal2` em `profiles`, `withUser` informa `aal` nos claims, testes de RLS (aal1 não lê/escreve nada) e de catálogo (toda tabela exposta precisa da política). Reprovado o ataque depois: 0 linhas, 0 alterações; o usuário legítimo com 2FA continua funcionando. **Recomendado também (passo manual): desligar a Data API** no painel do Supabase, já que o app só acessa o banco pelo servidor.
- **#2 suspeita, refutada por teste:** o Auth recusa cadastrar um 2º fator com JWT `aal1` (`403 insufficient_aal: AAL2 required to enroll a new factor`). A garantia vale no servidor de Auth, não só nas Server Actions.
- **#3 corrigido:** o cookie padrão do `@supabase/ssr` é sem `HttpOnly`, sem `Secure` e com 400 dias, e a biblioteca **ignora** `maxAge` de `cookieOptions` ao gravar. As opções finais são impostas no `setAll` (`finalizeCookieOptions`): `HttpOnly`, `Secure` em produção, `SameSite=Lax`, 8 h; `maxAge: 0` (logout) preservado. Verificado no navegador (e2e).
- **#7 corrigido:** matcher do proxy ancorado (`robots\.txt$`, `icon\.png$`, ...); testes avaliam a regex contra caminhos parecidos (`/robots.txtX`) e e2e confirma.
- **#8 corrigido:** `users:link` mostra o estado anterior e exige `--yes` para ALTERAR um perfil existente; ambos os comandos imprimem o projeto alvo.
- **#5 mitigado:** `users:reset-mfa --yes` avisa para trocar a senha antes de liberar o acesso. Risco do processo: entre criar o usuário (ou resetar o 2FA) e ele cadastrar o autenticador, quem souber a senha pode cadastrar o próprio. Criar o usuário e cadastrar o 2FA no mesmo ato, com senha temporária forte.
- **#9 corrigido:** e2e só rodam se URL pública, `DATABASE_URL` e `DIRECT_URL` apontam para o MESMO projeto de `MIGRATION_PROJECT_REF`.
- **#10 corrigido:** teste varre `src/app/(app)/**/page.tsx` e falha se alguma página não chamar `requirePageAccess` com a própria rota ou não estiver na matriz.

**Riscos aceitos / adiados para a 1A-3 (registrados):**
- **#4 limites do Auth são "por IP" do servidor do app:** as chamadas ao Supabase saem do IP de saída da Vercel, então o limite de login/MFA vira um balde compartilhado. Quem dispara tentativas pelo formulário pode causar 429 para todos (DoS, sem atribuição). Atacante indo direto ao GoTrue continua limitado pelo próprio IP. 1A-3: limitador próprio por e-mail e IP real antes de chamar o Supabase, com backoff por conta.
- **#6 JWT `aal2` vale até o `exp` (padrão 1 h) mesmo após logout/`reset-mfa`:** a verificação é local (`getClaims`). Desativar o perfil vale na hora (a DAL consulta o banco). Reduzir a validade do JWT no painel (ex.: 15 a 30 min) e avaliar `getUser()` em operações muito sensíveis.
- **#11 lacunas menores:** `verifyMfaLogin` usa o primeiro fator verificado (a UI não permite cadastrar um 2º); DAL com perfil inativo contra o banco real só via mock (a RLS tem teste de banco); e2e não chama uma Server Action de 2FA com aal1 fora do passo (as ações têm teste unitário do passo).
