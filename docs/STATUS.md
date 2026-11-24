# STATUS — estado atual e próximo passo

> Leia este arquivo ao começar uma sessão nova (ex.: em outro computador). Atualize-o ao fim de cada etapa.
> **Última atualização:** 2026-11-24 (fim do dia) · Regras de trabalho: `AGENTS.md` · Requisitos: `docs/PRD.md`

## Onde estamos
Tudo abaixo está **mesclado na `dev`** (PRs no GitHub). O detalhe de cada fase mora na spec e no plano (`docs/specs/`, `docs/plans/`); a arquitetura que vale para o código novo está em "Instalado" no `AGENTS.md`. O texto longo antigo deste arquivo continua no histórico do git (`git log -p docs/STATUS.md`).

| Fase | PR | Spec |
|---|---|---|
| 0 Fundação (Next.js, Tailwind, identidade, testes) | #1 | — |
| 1A-1 Banco, Drizzle e RLS | #3 | `2026-11-05-fase-1a1-banco-rls.md` |
| 1A-2 Login por senha + 2FA TOTP para todos | #4 | `2026-11-06-fase-1a2-login-2fa.md` |
| 1A-3 Endurecimento (CSP com nonce, limite de tentativas, inatividade de 30 min) | #5–#8 | `2026-11-07-fase-1a3-endurecimento.md` |
| 1B-1 Serviços e convênios | #10 | `2026-11-17-fase-1b1-servicos-convenios.md` |
| 1B-2a Profissionais · 1B-2b Grade de horários | #11 · #12 | `2026-11-17-fase-1b2a-profissionais.md` · `2026-11-17-fase-1b2b-grade-horarios.md` |
| 1B-3a Pacientes · 1B-3b Consentimentos LGPD e reativar removido | #13 · #15 | `2026-11-18-fase-1b3-pacientes.md` · `2026-11-22-fase-1b3b-consentimentos.md` |
| 2A Núcleo da agenda · 2B Telas · recepção edita grade e folgas | #17 · #19 · #18 | `2026-11-22-fase-2-agenda.md` · `2026-11-22-recepcao-grade-horarios.md` |
| 3A Séries e pacotes de sessões | #21 | `2026-11-23-fase-3a-series.md` |
| 3B-1 Lista de espera: cadastro (`/lista-espera`, só admin e recepção; migrações 0029–0033) | #22 | `2026-11-23-fase-3b-lista-espera.md` |
| **3B-2 Sugestão da espera ao cancelar e agendar com um clique** (sem migração) | #23 | mesma spec da 3B (seção "3B-2") |
| **4A Prontuário em texto** (evolução, finalização trancada, adendo e log de acesso; migrações 0034–0038) | *aguardando commit/PR* | `2026-11-24-fase-4a-prontuario.md` |

- **Última verificação completa (2026-11-24, 4A):** `lint`, `typecheck`, `build`, 105 arquivos / 2141 testes e e2e completo (174 passaram, 63 pulados de propósito, 0 falharam). Três revisões independentes: nenhum achado crítico; os importantes foram corrigidos (detalhe na spec, "Como ficou"). **Conferência manual:** só o admin viu a seção "Prontuário" na ficha (somente leitura, "Nenhuma evolução registrada."); profissional e recepção ainda não.
- **Em andamento:** a **Fase 4A** está pronta na branch `feat/fase-4a-prontuario` (nada commitado: o usuário pede o commit, abre o PR para a `dev` e faz o merge). **Próxima:** a **Fase 4B** (anexos e Storage, com a prova do consentimento; spec própria; a regra de sigilo já decidida vale: cada profissional só vê o que anexou), a produção (Supabase e Vercel) ou o WhatsApp (fase 6).
- **Ainda não existem:** a criação de logins dentro do app e o anexo da prova do consentimento (fase 4, Storage). A `main` continua só com a documentação inicial, de propósito, até existir o Supabase de produção (falta existir antes de mesclar a `dev` na `main`).

## Infraestrutura (já criada pelo usuário)
| Item | Situação |
|---|---|
| GitHub | `github.com/Lucasyuri15/clinicalopez` · branches `main` (produção) e `dev` (testes). PRs sempre para a `dev`. |
| Vercel | Projeto `clinicalopez` importado do GitHub. Framework Preset = **Next.js** (estava em *Other* e dava 404). Production = `main` (hoje 404 em `clinicalopez.vercel.app`, esperado). Branches `dev` e `feat/*` geram **Preview**, protegido por login da Vercel. Plano **Hobby**; o usuário aceitou o uso interno (os termos do Hobby falam em uso não comercial: risco assumido por ele, trocar para Pro se necessário). |
| Supabase **dev** | Projeto com ID `ccugjgpbprxhdwtvemll` (API: `https://ccugjgpbprxhdwtvemll.supabase.co`), plano **Free**, região São Paulo. **Migrações 0000–0038 aplicadas** (`profiles`, enum `user_role`, schema `app`, função `app.current_app_role()`, papel `app_backend` com timeouts, 4 políticas de RLS, privilégios padrão sem grants para `anon`/`authenticated`). **O plano Free PAUSA o projeto após cerca de uma semana sem uso:** ao voltar, retome no painel; se o banco recusar a senha de `app_backend` (erro `28P01`), redefina-a no SQL Editor (`alter role app_backend with password '<nova>'`) e atualize a `DATABASE_URL` no `.env.local` **e** no Preview da Vercel (isto também pesa na decisão Free × Pro da produção). Conexões: `DATABASE_URL` = Transaction pooler (6543, `app_backend.<ref>`); `DIRECT_URL` = **Session pooler** (5432, `postgres.<ref>`) porque a conexão direta é só IPv6. A senha de `app_backend` foi gerada localmente e está só no `.env.local` de **cada máquina**. **Auth:** cadastro público DESLIGADO ("Allow new users to sign up") e TOTP MFA habilitado (confirmados pelo usuário). |
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
5. **Migrações 0000–0038:** operação deliberada, com a sua confirmação, numa sessão separada em que `DIRECT_URL` (Session pooler do prod) e `MIGRATION_PROJECT_REF` (ref do prod) apontam para o prod; depois voltar o `.env.local` ao dev. Conferir antes com `pnpm db:migrate` apenas depois de ler qual projeto a trava aceitou.
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
4. **Onde paramos (2026-11-24):** a `dev` está em dia com o GitHub (`40e5536`, merge do PR #24). A branch **`feat/fase-4a-prontuario`** tem a Fase 4A pronta e **sem commit** (arquivos novos e alterados no diretório de trabalho; commitar e abrir o PR antes de trocar de computador). As migrações **0001 a 0038 já estão no Supabase dev** (o mesmo banco em qualquer PC: não rodar migração de novo).
   - **Decisões:** o login `admin` é só para desenvolvimento; no dia a dia usam recepção e profissional. A recepção grava grade e folgas; **cadastro de profissional, catálogo/valores e remover paciente seguem só do admin** (o usuário decide, caso a caso, se mais coisas passam para a recepção). 2FA é obrigatório para todos e o banco exige `aal2`: não dá para desligá-lo em contas de teste.
   - **Contas de teste no dev:** `admin@`, `recepcao@` e `profissional@` `clinicalopez.test` (criadas direto no banco pelo dono e vinculadas com `users:link`; senhas redefinidas pelo painel se perdidas; o 2FA o usuário cadastra no primeiro login). O banco dev também guarda dados que o próprio usuário criou à mão (1 paciente com consentimentos, 1 profissional com horários): os dados de e2e levam a etiqueta `[e2e-cat xxxxxxxx]`, **nunca apagar linhas sem ela**.
   - **Pendências, por ordem:** (1) conferência manual com **recepção e profissional** (no outro PC): `/agenda`, consentimentos, séries e a **lista de espera** (o admin já conferiu a lista no desktop e no celular); (2) **decisão de produto da 3B-2 (sem pressa):** quem acabou de cancelar deve aparecer como candidato do próprio horário se tiver espera aberta do mesmo serviço? (hoje aparece); os outros menores da revisão estão na spec; conferir também a sugestão ao cancelar com recepção e profissional; (3) *(resolvido em 2026-11-24, PR #24)* o teste instável `appointments-data` × `appointment-series-data`: a janela do admin em `listAppointments` enxergava as sessões do outro arquivo na mesma data; o teste de séries foi para novembro/2031 (+22 semanas). **Regra:** cada teste de dados que commita usa dias exclusivos (agenda 2031-06-02/03, séries 2031-11, espera 2031-08/09); (4) **Fase 4A (sem pressa):** conferir no navegador com o profissional (escrever, finalizar, adendar) e a recepção (sem a seção); o admin (só leitura) já foi conferido em 2026-11-24; decidir se o login de um profissional pode mudar de pessoa (hoje quem o admin ligar ao cadastro passa a ler as evoluções antigas: spec, "Como ficou"); (5) o **resíduo de e2e de 22/11** no banco dev (etiquetas `[e2e-cat …]`) foi deixado de propósito, por decisão do usuário: **não apagar**. Regra: toda Server Action nova chama `requireUser`/`requireRole`/`requirePageAccess` (o `server-actions-guard.test.ts` falha se esquecer). Tela de usuários dentro do app (exigiria a chave *secret* no servidor) segue adiada.
   - **Registrado, sem urgência:** **lentidão em modo dev medida (2026-11-23):** cada `withUser` custa ~315 ms (5 idas ao banco de ~52 ms) e a `/agenda` faz 4 etapas em série (~2 a 3 s); em produção, com o servidor perto do banco, deve cair muito (estimativa, não medida). Ideias: buscar atendimentos junto com as grades; `withUser` com 4 idas (mexe na RLS: revisão obrigatória); aviso de carregamento nos botões. Consulta da grade (`getWeek`) por profissional a cada carga da agenda da equipe; testes de corrida criar × cancelar e remarcar × folga; suíte em ~140 s; sem salto de data na agenda; produção do Supabase e Vercel ainda não existem. `applyUserContext` (`with-user.ts`) faz 2 idas ao banco por requisição e poderia fazer 1 com `set_config('role', …)` (mexe no caminho de RLS: revisão independente obrigatória); subir o `maxWorkers` do Vitest pode estourar o limite de conexões do pooler do plano Free.
   - **Neste Mac (macOS):** `pnpm` roda direto; o servidor dev sobe com `pnpm dev`. **Noutro PC (Windows):** `corepack pnpm …` (o `pnpm` não está no PATH); o Playwright precisa de um atalho `pnpm` no PATH da sessão; o relógio do Windows precisa estar sincronizado (senão o código do 2FA é recusado). O `.env.local` não vai para o Git: copiá-lo para o outro PC.

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
