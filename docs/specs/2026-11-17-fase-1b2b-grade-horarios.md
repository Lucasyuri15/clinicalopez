# Spec — Fase 1B-2b: Grade de horários dos profissionais

**Status:** aprovada pelo usuário em 2026-11-17 (plan mode). **Plano:** `docs/plans/2026-11-17-fase-1b2b-grade-horarios.md`.

## Contexto
A 1B-2a (cadastro de profissionais) está na `dev` (PR #11). A grade é o que a agenda da fase 2 consulta para saber quando cada profissional pode ser agendado. Duas partes (PRD 4.1):
- **Grade semanal:** dias e horários de atendimento, com intervalos (o intervalo é o vão entre duas faixas do mesmo dia).
- **Folgas e bloqueios:** exceções em datas específicas (férias, um dia de folga, uma tarde bloqueada).

Ordem da 1B: 1B-1 ✅ → 1B-2a ✅ → **1B-2b** → 1B-3 Pacientes.

## Decisão do usuário
| Tema | Decisão |
|---|---|
| Quem altera | **Admin** cria/edita/apaga a grade e as folgas/bloqueios · **Recepção** lê todas · **Profissional** lê **só as próprias** (via vínculo com o login) |

## Decisões técnicas
- **Faixas por dia:** cada linha é uma faixa de atendimento (`weekday`, `start_minute`, `end_minute`). Faixas são **meio-abertas** `[início, fim)`: 8h–12h e 12h–14h encostam sem conflito.
- **Minutos desde a meia-noite** (`smallint`): início 0–1435, fim 5–1440, múltiplos de **5 min**, início < fim. `weekday` 0–6 com **0 = domingo** (igual a `Date.getDay()` e a `EXTRACT(dow)`).
- **Sem sobreposição no banco:** `EXCLUDE USING gist (professional_id WITH =, weekday WITH =, int4range(start_minute, end_minute) WITH &&)` (extensão `btree_gist`; o drizzle-kit não modela exclusão: SQL à mão). Plano B se a extensão não puder ser criada: índice único `(profissional, dia, início)` mais verificação com trava.
- **Editar a semana = substituir o conjunto** (apaga as faixas do profissional e recria, numa transação). Por isso as duas tabelas aceitam **DELETE só do admin** (configuração, não registro clínico) e não têm UPDATE.
- **Folgas e bloqueios** em `professional_time_off` (`starts_at`, `ends_at` em `timestamptz`, `reason` opcional ≤ 120). Folga de dia inteiro = da meia-noite do primeiro dia à meia-noite depois do último; bloqueio parcial = horário dentro do dia. Datas digitadas em **horário de Brasília** e guardadas em UTC; a conversão usa `Intl` (o Brasil já teve horário de verão; nada de −3 h fixo). Período máximo de 366 dias; sobreposição entre folgas é permitida (a união vale).
- **O motivo da folga** é texto livre visível à recepção e ao próprio profissional: a tela avisa para **não registrar dado de saúde**. Sem auditoria de quem criou (adiada).
- **Contrato com a agenda (fase 2):** disponibilidade = grade semanal − folgas/bloqueios. Alterar a grade não reescreve atendimentos já marcados.

## Modelo de dados
- `professional_work_hours`: `id`, `professional_id` → `professionals` (restrict), `weekday`, `start_minute`, `end_minute`, `created_at`; checks e exclusão acima.
- `professional_time_off`: `id`, `professional_id` → `professionals` (restrict), `starts_at`, `ends_at`, `reason`, `created_at`; checks: `starts_at < ends_at` e período ≤ 366 dias.
- **RLS** (`enableRLS`, `REVOKE` de `anon`/`PUBLIC`, `aal2` RESTRICTIVE nas duas, papel por `app.current_app_role()`):
  - SELECT: admin (todas); reception (profissional **não removido**); professional (só quando `professionals.profile_id = auth.uid()` e não removido).
  - INSERT e DELETE: só admin (INSERT exige profissional não removido); sem UPDATE.
  - Escrita de não-admin falha sempre com 42501, antes de qualquer constraint.

## Fora do escopo
Agenda e conflito com atendimentos (fase 2); regras por serviço e duração de consulta; pacientes (1B-3); auditoria genérica; "copiar horário para outros dias".

## T2 — migrações como ficaram, e a revisão independente
- **0014** (DDL gerado): tabelas `professional_work_hours` e `professional_time_off`. **0015** (SQL à mão): extensão `btree_gist` (disponível no dev; spike conferido antes de aplicar), a exclusão `professional_work_hours_no_overlap` (`EXCLUDE USING gist (professional_id WITH =, weekday WITH =, int4range(start_minute, end_minute) WITH &&)`; o drizzle-kit não modela exclusão), grants e políticas de RLS. **0016:** `CHECK` de datas das folgas entre 2000-01-01 e 2101-01-02.
- Testes: `schedule-rls.test.ts` (por perfil e tabela, `aal1`, perfil desativado ou removido depois de vinculado, sobreposição recusada com 23P01 e faixas que encostam aceitas, limites, privilégios).
- **Revisão independente da migração e da RLS:** sem achado crítico (nenhum caminho para o profissional ler a grade de um colega, nem para não-admin ou `aal1` gravar; a escrita de não-admin falha com 42501 antes de qualquer constraint, então o texto do erro de sobreposição não vaza).
  - **Corrigido:** datas absurdas ("0026"; `9999-12-31` mais um dia estourava dentro do Zod): `isRealDate`, `addDaysToDate` e `zonedToUtc` corretos para qualquer ano, e faixa 2000–2100 no app **e** no banco (0016); motivo com byte nulo ou caractere de controle: mensagem em português; **corrida entre dois admins** (apagar e recriar sem trava duplicaria ou daria 23P01): trava por profissional (`pg_advisory_xact_lock`) na gravação, com teste de duas gravações simultâneas; testes que não provavam nada (perfil sem vínculo): casos de admin desativado ou removido e de profissional vinculado com perfil desativado.
  - **Aceito:** o `service_role` mantém os grants padrão (igual à 1B-2a; o app não o usa); a exclusão não aparece no snapshot do drizzle (um futuro `drizzle-kit generate` não a conhece).

## T3 a T5 — como ficou
- **Regras puras** (`src/lib/schedule/`): `time.ts` (horas em minutos, `parseTime`/`formatTime`, dias em pt-BR com 0 = domingo), `week.ts` (`validateWeek`: faixas de 5 em 5 min, fim depois do início, sem sobreposição no dia, no máximo 6 faixas por dia; `summarizeWeek`), `schemas.ts` (Zod da semana em JSON e da folga), `format.ts` (`describeTimeOff`) e, em `src/lib/datetime.ts`, `zonedToUtc`/`isRealDate`/`addDaysToDate` com **fuso de Brasília via `Intl`** (hora que não existiu resolve para a frente; hora repetida, para a primeira; testes com o horário de verão de 2018/2019).
- **Dados** (`src/server/schedule/{queries,mutations}.ts`, só por `withUser`): `getWeek`, `listTimeOff` (futuras e dos últimos 30 dias), `getScheduleOwner`; `saveWeek` substitui a semana inteira numa transação (confere que tudo o que se via foi apagado, senão "limpar" viraria um sucesso falso para quem a RLS nega); `addTimeOff`; `removeTimeOff`. `23P01` vira `overlap`. Teste de integração pelo caminho real (`schedule-data.test.ts`).
- **Ações** (`src/server/schedule/actions.ts`): `requireRole("admin")` primeiro; Zod; mensagens fixas em pt-BR; em erro devolvem o que foi digitado. O `server-actions-guard.test.ts` cobre o arquivo novo sem mudança.
- **Telas:** `/profissionais/[id]/horarios` (botão "Horários" em cada cartão). Admin: editor da semana (por dia, faixas com início e fim em `<input type="time" step=300>`; o intervalo é o vão entre faixas; um só "Salvar horários") e folgas/bloqueios (período, dia inteiro ou horário, motivo com aviso para não registrar dado de saúde; lista com "Remover"). Recepção e profissional: resumo somente leitura e lista de folgas; o profissional vê "Meus horários" e a grade de um colega vira "não encontrado" (a RLS não devolve o cadastro). Os formulários são componentes de cliente com estado local e campo oculto em JSON; o servidor revalida tudo.
- **e2e:** `schedule.spec.ts` (admin monta a semana com intervalo, sobreposição recusada em português e nada gravado, folga de dia inteiro e bloqueio parcial, remoção; recepção só lê) e `professional-role.spec.ts` (o profissional vê só o próprio cadastro e a própria grade, nem escondidos no HTML). Os testes do perfil profissional ficam num **único arquivo em modo serial** porque vinculam o mesmo login fictício e o banco só permite um profissional ativo por login (com `fullyParallel`, dois arquivos podiam colidir). As folgas dos testes são relativas a hoje em Brasília (não envelhecem). Capturas de tela conferidas no desktop e no celular.

## T6 — revisão final da 1B-2b (subagente independente) e resposta
Sem achado crítico: nenhuma fuga entre profissionais (props dos componentes, árvore da página por papel, `getScheduleOwner` nulo antes de qualquer consulta), `requireRole` primeiro em toda ação, fuso independente do relógio do servidor (conferidos 2000, 2100, hora repetida e hora inexistente), trava e rollback corretos, `revalidatePath` de rota dinâmica conforme a documentação do Next 16.
**Corrigido:** e2e instável (os dois testes de profissional vinculavam o mesmo login e podiam rodar em paralelo; agora num arquivo serial); `crypto.randomUUID` quebrava "Adicionar faixa" fora de HTTPS (celular em rede local, em desenvolvimento): agora um contador; os avisos "Horários salvos." e "Adicionado." ficam numa região de status sempre presente (leitores de tela).
**Aceito e registrado:** a tela não cria faixa que termine às 24:00 (o campo de hora vai até 23:59; o banco e a API aceitam 24:00) e um fim às 24:00 gravado por fora aparece vazio; o editor não se atualiza se outro admin mudar a semana enquanto ele está aberto (vale a última gravação: é a decisão "substituir o conjunto"); remover folga não pede confirmação (é configuração, dá para recriar); folgas terminadas há mais de 30 dias saem da lista e não podem ser removidas pela tela; na hora de 00:00 que não existiu em 4/11/2018, a folga de "dia inteiro" aparece como intervalo de horas (só datas do antigo horário de verão); depois de um erro os campos da folga são remontados e o foco volta ao início do formulário.
