# STATUS — estado atual e próximo passo

> Leia este arquivo ao começar uma sessão nova (ex.: em outro computador). Atualize-o ao fim de cada etapa.
> **Última atualização:** 2026-11-17 · Regras de trabalho: `AGENTS.md` · Requisitos: `docs/PRD.md`

## Onde estamos
- **Fase 0 (fundação) concluída e mergeada na `dev`** (PR #1): Next.js 16 + pnpm, Tailwind/shadcn, identidade visual, layout responsivo com telas provisórias, utilitários de moeda e data, cabeçalhos de segurança/`noindex`, testes Vitest + Playwright.
- **Fase 1A-1 (banco, Drizzle e RLS) concluída e mergeada na `dev`** (PR #3). Spec: `docs/specs/2026-11-05-fase-1a1-banco-rls.md`; plano: `docs/plans/2026-11-05-fase-1a1-banco-rls.md`. Entregou: conexão com o Supabase dev (`app_backend` pelo pooler), Drizzle + migrações versionadas, tabela `profiles` com RLS (admin vê/gerencia todos; os demais só o próprio perfil; ninguém apaga), `withUser` (único acesso a dados, assume `authenticated` + usuário), trava de `db:migrate` por projeto (estrita), regra ESLint contra o cliente cru, testes de RLS e de catálogo contra o dev. Revisada por subagente; achados importantes corrigidos (ver spec).
- **Fase 1A-2 (login, 2FA e perfis) concluída e mergeada na `dev`** (PR #4). Spec: `docs/specs/2026-11-06-fase-1a2-login-2fa.md`; plano: `docs/plans/2026-11-06-fase-1a2-login-2fa.md`. Entregou: login por senha + **2FA TOTP para todos**, `proxy.ts` (checagem otimista), DAL de sessão (`requireUser/requireRole/requirePageAccess`), matriz de acesso por tela (admin = tudo; recepção = Dashboard/Agenda/Pacientes/Financeiro; profissional = Dashboard/Agenda/Pacientes), menu por papel e "Sair", página `/sem-acesso`, comandos locais `users:link` e `users:reset-mfa`, e2e autenticados contra o Supabase dev. Revisada por subagente (ver spec).
- **Fase 1A-3 (endurecimento) concluída** (PRs #5 a #8 na `dev`; fechamento na branch `feat/fase-1a3-fechamento`). Spec: `docs/specs/2026-11-07-fase-1a3-endurecimento.md`; plano: `docs/plans/2026-11-07-fase-1a3-endurecimento.md`. Entregou:
  - **CSP com nonce** no `src/proxy.ts` (`src/lib/security/csp.ts`), verificada no build de produção; para isso `cacheComponents` e `partialPrefetching` ficam **desligados** e o layout raiz espera a requisição (`connection()`).
  - **Limite de tentativas próprio** (login e 2FA; por IP real e por e-mail+IP, atraso crescente; tabela `auth_attempts` + funções `app.rate_limit_*`; migrações **0004 e 0005 aplicadas só no Supabase dev**). Não protege contra quem chama o Supabase Auth direto (risco aceito: Auth Hooks são Teams/Enterprise).
  - **Timeout de inatividade de 30 min** (cookie `ls_activity` HttpOnly gerido só pelo `proxy`; decidido pelos cookies antes do `getClaims`; Server Action não leva 307). O cookie de 8 h é deslizante, não um teto absoluto.
  - **Pool e ambientes:** `max_pipeline: 1` (bug do pool), `connect_timeout: 10`, **guarda de projeto** (`NEXT_PUBLIC_SUPABASE_URL` e `DATABASE_URL` do mesmo projeto), tabela variável × ambiente e checklist de produção (abaixo).
  - **Pendências da 1A-2:** `verifyMfaLogin` exige exatamente um fator verificado; DAL × perfil inativo contra o banco real; e2e de Server Action de 2FA fora do passo.
  - **Fechamento (T6):** revisão independente da 1A-3 inteira, sem achado crítico; corrigidos o limitador estourando com variável de ambiente inválida e um teste (`server-actions-guard.test.ts`) que exige que toda Server Action se proteja (o `proxy` deixa passar o POST de ação). Itens aceitos (teto de 8 h, IP forjável fora da Vercel, pool sob enxurrada etc.): ver a spec, seção T6.
- **Fase 1B (cadastros) EM ANDAMENTO, dividida do mais simples ao mais sensível:** **1B-1 Serviços + Convênios** (na `dev`, PR #10) → **1B-2a Profissionais** (feita, na branch `feat/fase-1b2a-profissionais`, ainda sem PR) → 1B-2b Grade de horários (semana, intervalos, folgas e bloqueios) → 1B-3 Pacientes (CPF, LGPD, visibilidade por profissional).
  **1B-1:** tabelas `services`, `insurances` e `service_prices` (valor particular = convênio nulo), migrações 0006 a 0009; RLS: admin edita; recepção lê tudo; **profissional lê só serviços, nunca valores nem convênios**. Telas `/servicos`, `/convenios`, `/convenios/[id]`. Spec: `docs/specs/2026-11-17-fase-1b1-servicos-convenios.md`.
  **1B-2a:** tabelas `professionals` e `professional_services`, migrações **0010 a 0013 aplicadas só no Supabase dev**. RLS: admin cria/edita/desativa; recepção lê todos (com contato); **profissional lê SÓ o próprio cadastro** (via vínculo com o login); sem DELETE em `professionals`; `aal2` em todas. O banco garante, por chaves estrangeiras compostas, que o login vinculado tem papel `professional` e que cada serviço é da mesma especialidade do profissional; um profissional removido solta o login. Tela `/profissionais` (admin edita numa gaveta; recepção lê; profissional vê "Meu cadastro"). Logins continuam sendo criados no painel do Supabase + `pnpm users:link`; a tela só escolhe um existente. Revisada por subagente em duas etapas (migração/RLS e telas/ações), sem achado crítico; o importante foi corrigido (ver a spec). Verificação: lint, typecheck, 738 testes, build e 88 e2e verdes. Spec: `docs/specs/2026-11-17-fase-1b2a-profissionais.md`; plano: `docs/plans/2026-11-17-fase-1b2a-profissionais.md`.
- **Ainda não existem:** grade de horários (1B-2b), pacientes (1B-3) e criação de logins dentro do app. A `main` continua sem o app de propósito até existir o Supabase de produção.
- **A `main` só tem a documentação inicial, de propósito.** A 1A-3 está concluída; falta existir o Supabase de produção antes de fazer merge da `dev` na `main`.

## Infraestrutura (já criada pelo usuário)
| Item | Situação |
|---|---|
| GitHub | `github.com/Lucasyuri15/clinicalopez` · branches `main` (produção) e `dev` (testes). PRs sempre para a `dev`. |
| Vercel | Projeto `clinicalopez` importado do GitHub. Framework Preset = **Next.js** (estava em *Other* e dava 404). Production = `main` (hoje 404 em `clinicalopez.vercel.app`, esperado). Branches `dev` e `feat/*` geram **Preview**, protegido por login da Vercel. Plano **Hobby**; o usuário aceitou o uso interno (os termos do Hobby falam em uso não comercial: risco assumido por ele, trocar para Pro se necessário). |
| Supabase **dev** | Projeto com ID `ccugjgpbprxhdwtvemll` (API: `https://ccugjgpbprxhdwtvemll.supabase.co`), plano **Free**, região São Paulo. **Migrações 0000–0013 aplicadas** (`profiles`, enum `user_role`, schema `app`, função `app.current_app_role()`, papel `app_backend` com timeouts, 4 políticas de RLS, privilégios padrão sem grants para `anon`/`authenticated`). **O plano Free PAUSA o projeto após cerca de uma semana sem uso:** ao voltar, retome no painel; se o banco recusar a senha de `app_backend` (erro `28P01`), redefina-a no SQL Editor (`alter role app_backend with password '<nova>'`) e atualize a `DATABASE_URL` no `.env.local` **e** no Preview da Vercel (isto também pesa na decisão Free × Pro da produção). Conexões: `DATABASE_URL` = Transaction pooler (6543, `app_backend.<ref>`); `DIRECT_URL` = **Session pooler** (5432, `postgres.<ref>`) porque a conexão direta é só IPv6. A senha de `app_backend` foi gerada localmente e está só no `.env.local` de **cada máquina**. **Auth:** cadastro público DESLIGADO ("Allow new users to sign up") e TOTP MFA habilitado (confirmados pelo usuário). |
| Supabase **produção** | **Ainda não criado.** Decisão pendente: pagar o Pro (backups automáticos) ou ficar no Free com backup nosso + aviso de risco. Pode esperar até antes de entrarem dados reais de pacientes. |

## Variáveis por ambiente (Vercel e máquina local)
| Variável | Local (`.env.local`) | Vercel **Preview** (`dev` e `feat/*`) | Vercel **Production** (`main`) | Observação |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | projeto **dev** | projeto **dev** | projeto **prod** | pública (Config). É embutida no **build**: ao trocar, faça novo deploy |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | chave do **dev** | chave do **dev** | chave do **prod** | pública (Config); nunca a `sb_secret_…` |
| `DATABASE_URL` | pooler 6543, `app_backend.<ref-dev>` | idem | pooler 6543, `app_backend.<ref-prod>` | **Secret**. O `<ref>` tem de ser o mesmo da URL pública (guarda do app) |
| `CLIENT_IP_HEADER` | vazio | vazio | vazio | opcional; só com outro proxy/CDN na frente da Vercel (ver a spec, achado #4) |
| `DIRECT_URL` | Session pooler 5432, `postgres.<ref-dev>` | **não definir** | **não definir** | dono do banco: só migrações e `users:*` |
| `MIGRATION_PROJECT_REF` | ref do **dev** | **não definir** | **não definir** | trava de `db:migrate`/`users:*`/testes |
Regra: o mesmo ambiente nunca mistura projetos. Preview → dev, Production → prod. Se `NEXT_PUBLIC_SUPABASE_URL` e `DATABASE_URL` forem de projetos diferentes, o app recusa na primeira consulta ao banco (mensagem cita só os nomes das variáveis). A guarda só compara URLs `<ref>.supabase.co` com usuário `app_backend.<ref>`; domínio próprio no Supabase ou Supabase local ficam fora dela.

## Checklist para criar o Supabase de PRODUÇÃO (manual; ainda não feito)
Só quando a decisão Free × Pro estiver tomada e antes de entrar dado real. Nunca rodar `pnpm dev`, testes ou migração experimental contra ele.
1. **Criar o projeto** (região São Paulo) com senha forte do dono; guardar no gerenciador de senhas, nunca no chat. Free não tem backup automático: decidir Pro ou backup nosso.
2. **Authentication:** desligar "Allow new users to sign up"; habilitar TOTP MFA; **JWT expiry = 1800 s**; NÃO apertar Rate Limits do login (spec, achado #2).
3. **Data API desligada** (igual ao dev).
4. **Papel `app_backend`:** criado pela migração 0001 sem senha. Definir a senha no SQL Editor (`alter role app_backend with password '<senha forte>'`), fora do Git.
5. **Migrações 0000–0013:** operação deliberada, com a sua confirmação, numa sessão separada em que `DIRECT_URL` (Session pooler do prod) e `MIGRATION_PROJECT_REF` (ref do prod) apontam para o prod; depois voltar o `.env.local` ao dev. Conferir antes com `pnpm db:migrate` apenas depois de ler qual projeto a trava aceitou.
6. **Vercel, ambiente Production:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (prod) e `DATABASE_URL` (Secret, `app_backend.<ref-prod>`). Nada de `DIRECT_URL` nem `MIGRATION_PROJECT_REF`. Novo deploy depois de salvar.
7. **Primeiro admin:** "Add user" no painel (e-mail real) → `pnpm users:link` (mesma troca temporária de `DIRECT_URL`/`MIGRATION_PROJECT_REF`) → cadastrar o 2FA logo em seguida.
8. **Só então** liberar a `main` para receber a `dev` (hoje sem o app de propósito) e conferir no navegador: login, 2FA, CSP sem violações, sair após 30 min parado.

## Próximo passo (NÃO esquecer)
1. **Passos manuais (estado atual):**
   - ✅ **Feito:** primeiro admin criado no Supabase dev (e-mail fictício) e vinculado com `users:link`; 2FA cadastrado e testado à mão (login, código errado, senha errada, sair/entrar); variáveis de **Preview** na Vercel registradas (`NEXT_PUBLIC_SUPABASE_URL` e `..._PUBLISHABLE_KEY` como Config; `DATABASE_URL` como Secret); **Data API desligada** no Supabase dev.
   - ✅ **JWT expiry = 1800 s aplicado no Supabase dev** (painel: Authentication → Sessions, campo "Access tokens"). **Repetir no projeto de produção** quando ele existir (passo 2 do checklist acima).
   - Mais usuários (recepção, profissionais) só no projeto de **produção**, com e-mails reais: Add user no painel + `pnpm users:link`. Cadastrar o 2FA logo após criar (entre a criação e o cadastro, quem souber a senha pode cadastrar o próprio autenticador).
   - **Perdeu o celular?** `pnpm users:reset-mfa <e-mail>` (simulação) e depois `--yes`; trocar a senha no painel antes de liberar o acesso. Recovery codes do Supabase são experimentais e **não** são usados. Esqueceu a senha: reset pelo painel (sem e-mail por ora).
   - Limitação conhecida (medida): o Supabase aceita o código TOTP da janela atual e de ±30 s, e aceita o **mesmo código mais de uma vez** na janela. Risco aceito (ver spec da 1A-2).
2. *(feito)* 1A-2 integrada na `dev` (PR #4).
3. *(feito)* **1A-3 concluída** (T0 a T6). Atenção ao reler a spec: NÃO apertar Authentication → Rate Limits do login (todo o tráfego do app sai por poucos IPs da Vercel; apertar aproxima o teto do balde compartilhado e o nosso limite deixa de ser o que vale; achado #2). **IP do cliente:** a Vercel sobrescreve `x-real-ip`/`x-forwarded-for` (confirmado na documentação), mas SÓ se for a borda mais externa: com Cloudflare ou outro proxy na frente (ex.: ao ligar domínio próprio), todos dividem um balde sem aviso; apontar `CLIENT_IP_HEADER` antes (achado #4). O Supabase de **produção** segue pendente (decisão Free x Pro adiada pelo usuário). Decisão em aberto, sem pressa: querer um teto **absoluto** de horas por login (hoje só há inatividade de 30 min; spec T6, M1).
4. **Agora: abrir o PR da 1B-2a e, depois do merge, começar a 1B-2b — Grade de horários** (dias e horários de atendimento, intervalos, folgas e bloqueios por profissional; é o que a agenda da fase 2 consulta; brainstorming e spec em plan mode). Em seguida a 1B-3 (Pacientes, que usa o vínculo profissional↔login criado na 1B-2a). Regra: toda Server Action nova chama `requireUser`/`requireRole`/`requirePageAccess` (o `server-actions-guard.test.ts` falha se esquecer). Tela de usuários dentro do app (exigiria a chave *secret* no servidor) segue adiada.

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
