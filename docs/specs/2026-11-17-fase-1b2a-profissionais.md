# Spec — Fase 1B-2a: Profissionais (cadastro, serviços e vínculo com o login)

**Status:** aprovada pelo usuário em 2026-11-17 (plan mode). **Plano:** `docs/plans/2026-11-17-fase-1b2a-profissionais.md`.

## Contexto
A 1B-1 (serviços e convênios) está na `dev` (PR #10). A 1B segue do mais simples ao mais sensível e a 1B-2 foi **subdividida**:
1. 1B-1 Serviços + Convênios ✅
2. **1B-2a Profissionais** (esta spec): cadastro (nome, especialidade, registro profissional, contato), serviços que cada um realiza e vínculo opcional com o login.
3. 1B-2b Grade de horários (semana, intervalos, folgas e bloqueios): spec e revisão próprias.
4. 1B-3 Pacientes (CPF, LGPD, "profissional só vê os próprios pacientes", que usa o vínculo criado aqui).

## Decisões do usuário
| Tema | Decisão |
|---|---|
| Divisão da 1B-2 | Cadastro agora (1B-2a), grade depois (1B-2b) |
| Acesso | **Admin** cria/edita/desativa e vincula o login · **Recepção** lê todos · **Profissional** lê **só o próprio cadastro**, sem ver colegas nem o contato deles |

## Decisões técnicas
- **Registro profissional opcional** (`registration`, texto livre de 3 a 30 caracteres). O conselho (CREFITO/CRO/CRP) é **derivado da especialidade** (só rótulo, não é guardado duas vezes).
- **Vínculo com o login:** `profile_id` opcional e único (entre os não removidos) em `professionals`. O banco garante que o perfil vinculado tem papel `professional` por **chave estrangeira composta** `(profile_id, link_role) → profiles(id, role)` (com `link_role` fixo em `professional` e `unique (id, role)` em `profiles`), sem trigger. Se o papel do perfil mudar, o banco recusa até desvincular.
- **Serviço × especialidade no banco:** `professional_services` tem `specialty` e duas FKs compostas para `professionals(id, specialty)` e `services(id, specialty)`. Um fisioterapeuta não recebe serviço de odontologia nem por chamada direta.
- **Trocar a especialidade** apaga e recria os serviços na mesma transação (a FK composta não permitiria trocar com serviços pendurados).
- **`professional_services` aceita DELETE só do admin** (tabela de ligação/configuração, não registro clínico). `professionals` segue sem DELETE (exclusão lógica).
- **Contato** (telefone só dígitos, 10 ou 11; e-mail opcional) na mesma tabela: quem lê o cadastro (admin, recepção, o próprio) lê o contato. Aceito: a recepção vê o contato dos profissionais.
- **Logins continuam criados no painel do Supabase** + `pnpm users:link` (nenhuma chave secret no app). A tela só **escolhe** um perfil `professional` existente e ainda livre.
- **Tela `/profissionais` para o profissional** mostra só o cadastro dele ("Meu cadastro").

## Modelo de dados
- `profiles`: `unique (id, role)`. `services`: `unique (id, specialty)`.
- `professionals`: `id`, `full_name` (1–120, sem espaço/quebra nas pontas, como na 1B-1), `specialty` (enum existente), `registration`, `phone` (`^[0-9]{10,11}$`), `email` (≤ 254, sem espaço nas pontas), `profile_id`, `link_role`, `active`, timestamps, `deleted_at`. Únicos parciais (só não removidos): `profile_id`; `(specialty, lower(full_name))`. `unique (id, specialty)`.
- `professional_services`: PK `(professional_id, service_id)`, `specialty`, `created_at`; FKs compostas (restrict).
- **RLS** (`enableRLS`, `REVOKE` de `anon`/`PUBLIC`, `aal2` RESTRICTIVE em cada tabela, papel por `app.current_app_role()`):
  - `professionals`: SELECT admin (todos), reception (não removidos), professional (**só `profile_id = auth.uid()`**, não removido). INSERT/UPDATE só admin. Sem DELETE.
  - `professional_services`: SELECT admin (todas), reception (profissional **e** serviço não removidos), professional (só as dos próprios). INSERT e DELETE só admin; sem UPDATE.

## Fora do escopo
Grade de horários, folgas e bloqueios (1B-2b); pacientes e visibilidade por paciente (1B-3); criar logins dentro do app; auditoria genérica (segue adiada).

## T2 — migrações como ficaram, e a revisão independente
- **0010** (DDL gerado pelo drizzle-kit): o gerador colocou os `UNIQUE` de `profiles` e `services` DEPOIS das chaves estrangeiras compostas que dependem deles, o que falharia no banco; como ainda não estava aplicada, reordenei à mão (os `UNIQUE` primeiro). **0011:** grants e políticas de RLS. **0012:** `CHECK (deleted_at is null or profile_id is null)`. **0013:** política `select_self` das ligações passa a esconder serviço removido.
- Testes: `professionals-rls.test.ts` (68 casos por perfil e tabela, `aal1`, FKs compostas, únicos com soft delete, privilégios) e o harness ganhou um segundo profissional (`professional2`) para provar que um não vê o outro.
- **Revisão independente da migração e da RLS:** sem achado crítico (nenhum caminho para o profissional ler colega, contato ou ligações de outro, nem para não-admin ou `aal1` gravar). **Corrigido:** (I1) um profissional removido guardava o login e travava a mudança de papel do perfil → a restrição da 0012 obriga a **soltar o login ao remover**; (I3) o banco aceita vincular perfil inativo/removido → o servidor valida (só ao vincular um login NOVO); (menor) profissional via ligação a serviço removido → 0013; testes novos (perfil desativado depois de vinculado deixa de ler; removido não mantém login; papel do perfil pode mudar depois de liberar). **Aceito e registrado:** (I2) trocar a especialidade de um serviço que já tem profissionais ligados é recusado pela chave estrangeira composta; a mensagem da edição de serviço agora explica o motivo provável (ver T4); o regex `^\S(.*\S)?$` depende da locale do Postgres para o que conta como espaço (mesmo padrão da 1B-1; o app já trata o 23514); `lower(full_name)` no índice único depende do ctype do banco.

## T3 a T5 — como ficou
- **Dados** (`src/server/professionals/{queries,mutations}.ts`, só por `withUser`): `listProfessionals` (com serviços; a RLS decide quem vê o quê), `listLinkableProfiles` (perfis `professional` livres; `keepProfileIds` mantém os já vinculados **mesmo desativados**, marcados), `createProfessional`/`updateProfessional`/`setProfessionalActive`. **Atomicidade:** criar/editar grava o cadastro e **substitui** os serviços numa única transação (apaga as ligações, atualiza, recria; um erro em qualquer passo desfaz tudo, provado no banco). Resultado é valor (`ok` | `duplicate-name` | `duplicate-login` | `not-found` | `denied`); `duplicate-*` distingue o índice pelo `constraint_name` (`pgConstraintName` em `pg-error.ts`). Teste de integração pelo caminho real (`professionals-data.test.ts`), fixtures commitados pelo dono e apagados no fim.
- **Ações** (`src/server/professionals/actions.ts`): `requireRole("admin")` primeiro; Zod; mensagens fixas em pt-BR; em erro devolvem o que foi digitado (`values`, serviços marcados juntos por vírgula). `server-actions-guard.test.ts` cobre o arquivo novo sem mudança.
- **Telas** (`/profissionais`): admin lista, cria e edita numa gaveta (nome, especialidade, registro com o conselho derivado, telefone, e-mail, login a vincular, serviços da especialidade escolhida; ativar/desativar; o login já vinculado a outro não é oferecido); recepção lê todos com contato e serviços, sem controles; profissional vê **"Meu cadastro"** com só o próprio. `access.ts`: `profissionais` = admin, recepção e profissional. Telefone guardado só em dígitos e mostrado como "(11) 91234-5678" (`src/lib/phone.ts`); o conselho não é repetido se já veio digitado (`formatRegistration`).
- **e2e** (`e2e/professionals.spec.ts`): admin cria com login e serviço (o banco confirma), troca a especialidade (zera os serviços), erros em pt-BR sem apagar o formulário, desativa e reativa; recepção só lê; **profissional não vê colega nem no HTML entregue**. Capturas de tela conferidas no desktop e no celular.

## T6 — revisão final da 1B-2a (subagente independente) e resposta
Sem achado crítico: nenhum vazamento de colega/contato ao profissional (props dos componentes, árvore da página por papel, mensagens, `values` devolvidos), `requireRole` primeiro em toda ação, rollback da transação com `Abort` (provado em Drizzle/postgres.js), `constraint_name` realmente exposto pelo erro.
**Corrigido:** teste unitário vermelho (`session.test.ts` ainda esperava a recepção negada em `/profissionais`); **editar um profissional cujo login foi desativado o desvinculava em silêncio** (a opção sumia da lista e o formulário enviava "sem login"): o login atual agora fica na lista, marcado "(inativo)", e há teste; botão "Salvar" fixo no rodapé da gaveta (muitos serviços no celular); tela de erro em português (`src/app/(app)/error.tsx`: um erro inesperado, como queda de conexão, mostrava a tela em inglês do Next); `testTimeout` do Vitest em 30 s (dois testes de RLS rodavam a 4,8 s do limite de 5 s e falhavam de vez em quando sem haver bug).
**Aceito e registrado:** botões "Editar"/"Ativar/Desativar" com 40 px no celular (acima do mínimo do WCAG AA; igual à 1B-1); `updateProfessional` lê o login atual sem `FOR UPDATE` (dois admins editando o mesmo profissional ao mesmo tempo: o índice único e a FK composta ainda protegem os dados); `normalizePhone` recusa prefixo de operadora ("0 11 …") de propósito; o guarda de Server Actions só confere a presença de `requireRole(` (a ordem é provada pelo teste de unidade da ação); sem e2e para "edição → desmarcar todos os serviços → erro do servidor".
