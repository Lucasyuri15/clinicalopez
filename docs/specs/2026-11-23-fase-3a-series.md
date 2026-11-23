# Spec — Fase 3A: séries e pacotes de sessões (recorrência)

**Status:** aprovada pelo usuário em 2026-11-23 (plan mode). **Plano:** `docs/plans/2026-11-23-fase-3a-series.md`. Entregue em duas partes: **3A-1 (núcleo)** e **3A-2 (telas)**. A lista de espera (3B) é outro plano.

## Contexto
O PRD (4.2) pede recorrência/pacotes: séries (ex.: fisioterapia 2x/semana por 10 sessões; psicoterapia semanal), edição de uma ocorrência ou da série inteira e acompanhamento de realizadas/restantes. A Fase 2 entregou a agenda com conflito protegido pelo banco (exclusões `btree_gist`). A série **reaproveita** essa barreira: cada sessão é um atendimento comum.

## Decisões do usuário
| Tema | Decisão |
|---|---|
| Ordem | 3A (séries) primeiro; 3B (lista de espera) depois, em outro plano |
| Conflito na criação | **Prévia** de todas as datas (cabe / não cabe, com o motivo); a recepção escolhe criar **só as que cabem** ou desistir. Nada é criado sem a pessoa ver |
| Fim da série | **Sempre com fim definido** (nº de sessões); sem série contínua e sem job agendado |
| Ações na série inteira | **Cancelar daqui para frente**, **Remarcar daqui para frente** e **Renovar série**. Trocar profissional/serviço da série fica de fora |

## Padrões assumidos (aprovados junto com o plano)
- Padrão: **um ou mais dias da semana, mesmo horário e mesma duração** (cobre "2x/semana"). Horários diferentes por dia: fora.
- A série começa na data escolhida e percorre os dias seguintes, pegando os dias marcados até completar N sessões. **2 a 60 sessões**, no máximo **1 ano** da primeira à última.
- "Só as que cabem": datas puladas **não** são repostas; o resultado lista as puladas e a recepção agenda à mão. O total da série é o que foi criado.
- Série **só para admin e recepção**: o profissional não vê tabela, selo nem progresso.
- `appointment_events` (histórico de mudanças, citado na spec da Fase 2) **não entra**; fica como item separado.

## Modelo
- `appointment_series` (identidade imutável: profissional, paciente, serviço, especialidade, autor, criação). Sem o padrão guardado: a renovação recebe o padrão no formulário.
- `appointments.series_id` (nulo) + **FK composta** `(series_id, professional_id, patient_id, service_id)`: o banco garante que toda sessão da série é do mesmo trio.
- Gatilho da 0025 reescrito (`CREATE OR REPLACE`) para tornar `series_id` imutável. `GRANT UPDATE` por coluna continua sem `series_id`.
- Conflito: as exclusões por profissional e por paciente **não mudam** e são a barreira final. A prévia é só informativa; cada sessão da criação entra num **savepoint**, então uma data que perde a corrida vira "pulada" sem derrubar as outras.
- Hora de parede: a data de cada sessão é calculada em dias de calendário (`addDaysToDate`) e convertida com `zonedToUtc`; nunca `+7×24 h`.
- Remarcar daqui para frente desloca as abertas e futuras por **dias de calendário** (novo dia − dia atual da sessão escolhida) e novo horário; a **ordem** de aplicação evita colisão entre irmãs (para a frente: da última para a primeira; para trás: o contrário). As que não cabem ficam como estão e são listadas.
- Cancelar daqui para frente: um `UPDATE` das abertas (`scheduled`/`confirmed`) da série com `starts_at >=` a da escolhida; o gatilho vale por linha.

## Como ficou — 3A-1 (núcleo, sem telas)
- **Regras puras** (`src/lib/appointments/series.ts`, testadas): `generateOccurrences` (hora de parede por dias de calendário, com teste do horário de verão que existiu até 2019), `classifyOccurrence` (mesma ordem de recusas de `createAppointment`; fim em 2101 ou depois é `invalid`, o limite do banco), `shiftSeriesFrom` (deslocamento em dias de calendário e **ordem de aplicação** que evita colisão entre irmãs; verificado por mutação) e `seriesProgress`. Zod em `schemas.ts` (`createSeriesSchema`, `renewSeriesSchema`); cancelar e remarcar "daqui para frente" reaproveitam `cancelAppointmentSchema` e `rescheduleAppointmentSchema`.
- **Migrações 0027 e 0028, só no Supabase dev** (a 0027 gerada pelo drizzle-kit; a 0028 à mão, como a 0025). Ensaiadas numa transação desfeita antes de aplicar. `appointment_series` (só `SELECT`/`INSERT`, admin e recepção, sem política para o profissional, `aal2` `RESTRICTIVE`, `service_role` sem escrita), `appointments.series_id` com **FK composta** (o banco garante o mesmo profissional, paciente e serviço) e o gatilho da 0025 reescrito só para tornar `series_id` imutável (diferença conferida linha a linha).
- **Camada de dados** (`src/server/appointments/series-mutations.ts`, só `withUser`): `previewSeries` e `previewRenewal` (só leem), `createSeries`, `renewSeries`, `cancelSeriesFrom`, `rescheduleSeriesFrom`. `createAppointment` foi refatorado em `loadBookingContext` + `insertOccurrence` + `linkPatient` sem mudar comportamento (os 39 testes anteriores seguem verdes). Cada sessão entra num **savepoint**: a que perde a corrida (`23P01`) ou que o relógio do banco já considera passada (`42501` da política) vira data pulada; sem nenhuma, `nothing-fits` e nada é gravado.
- `queries.ts`: `AgendaItem.series` (id + andamento) só para a equipe, com **uma** consulta extra e só quando há série na tela; `toItem` passou a copiar campo a campo (um `...row` deixaria o `series_id` escapar).
- **Ações** (`series-actions.ts`, 6 ações, todas `requireRole("admin", "reception")` antes de ler a entrada; verificado por mutação, e o guarda global também falha). Mensagens fixas em `messages.ts` (compartilhadas com `actions.ts`). Datas voltam como texto ISO.
- **Testes:** 124 a mais na suíte (1765 no total). RLS por perfil em dois arquivos (`appointment-series-rls*.test.ts`), dados reais em `appointment-series-data.test.ts` (32: tudo livre, folga, conflito de profissional e de paciente, passado, nenhuma cabe, concorrência, valor copiado, cancelar e remarcar daqui para frente com deslocamento de ±2 dias, renovação, consultas) e ações em `series-actions.test.ts`.

## Revisão independente do 3A-1
Subagente com contexto enxuto (requisitos e arquivos, sem as conclusões do autor). **Nenhum achado crítico.** Gatilho, RLS, migrações, preço copiado, cancelar daqui para frente e validação conferidos sem defeito.
- **Corrigidos (com teste):** (2) série que passa de 2100 (a prévia aceitava datas de 2101 e a criação falhava inteira): recusada no schema e `invalid` na classificação; (3) relógio do banco à frente do app: `42501` no `INSERT` e `23514` no gatilho viram data pulada `past`, não falha geral; (4) limite de data não aparece mais como "já passou"; (5) duas remarcações da mesma série ao mesmo tempo podiam se sobrescrever: o `UPDATE` agora exige o horário que foi lido (teste **determinístico**, que falha sem o guarda); (6) sessão fechada entre duas leituras devolvia sucesso com 0 movidas: agora `changed`; (7) `loadBookingContext` levava o pedido inteiro. Em consequência, `55P03` (`lock_timeout` de 5 s do papel do app) passou a virar "sistema ocupado" em vez de erro cru.
- **Exceção registrada e ACEITA pelo dono em 2026-11-23 (achado 1):** o profissional **consegue ler o UUID `series_id`** das **próprias** sessões (a leitura de `appointments` é por tabela, e os três perfis são o mesmo papel de banco, então um privilégio de coluna não separa equipe de profissional). O app nunca o repassa a ele (`toItem` campo a campo, teste que procura o id no JSON). Alternativa considerada e descartada pelo dono: mover o vínculo para uma tabela só da equipe (`appointment_series_sessions`), com custo de uma tabela e uma junção a mais em toda leitura da agenda.
- **Lacunas de teste que o revisor listou e ficam sem teste de propósito:** remarcar para a frente quando uma irmã é pulada e a escolhida bate nela (o resultado é `conflict-professional` e nada move: comportamento documentado).

## Como ficou — 3A-2 (telas)
- **Agendar** (`appointment-form-sheet.tsx` + `series-section.tsx`): caixa "Repetir semanalmente" na mesma gaveta e com os mesmos campos; dias da semana (o da data escolhida já vem marcado), número de sessões, **Ver prévia** (só lê) e **Criar N sessões** (só aparece com prévia **não velha**). Datas puladas: a gaveta fica com um resumo; sem puladas, fecha. Um único `useActionState` com o campo `intent` (prévia ou criar); Enter sempre cai na prévia, nunca em criar.
- **Detalhe** (`appointment-sheet.tsx`, só equipe e só sessão de série): andamento ("Sessão 3 de 10 · 2 realizadas · 7 restantes"), escolha **"Só esta sessão / Esta e as seguintes da série"** em Remarcar e Cancelar (campo oculto `scope`; uma ação por escopo) e **Renovar série** (mesma seção da criação, com prévia). Sessões que não couberam ao remarcar voltam num resumo. **Cartão:** selo "Série 3/10" e nome acessível com a posição.
- `useFormAction` virou genérico (estado da agenda ou das séries) com `keepOpen` para segurar a gaveta quando há resumo. Nada de dado do paciente na URL; só tokens do tema; prévia com ícone **e** texto (não só cor); alvos de toque de 44 px.
- **Testes:** componentes (`series-preview-list.test.tsx`), textos puros (`series-format.test.ts`) e e2e `series.spec.ts` (admin e recepção: criar pela prévia, só as que cabem com resumo, cancelar e remarcar daqui para frente, renovar) + teste do **profissional** em `professional-role.spec.ts` (nada de série, nem no HTML; verificado por mutação).

## Revisão independente das telas (3A-2)
Subagente com contexto enxuto. **Nenhum achado crítico; o isolamento do profissional está sólido** (`toItem` campo a campo, `attachSeries` só para a equipe).
- **Corrigidos:** (importante) uma edição feita **durante** o cálculo da prévia chegava "fresca" e o Criar gravava dados diferentes dos mostrados: os campos ficam `disabled` enquanto calcula (`<fieldset disabled>`); (importante) "Criando…" aparecia com só a prévia rodando: cada botão mostra só o próprio texto; (importante) região de status que nasce com texto não é anunciada: agora há uma **sempre montada**, e o resumo recebe o foco quando substitui o formulário; alternar "Repetir" depois de uma prévia apagava o digitado (teste e2e novo); dias da semana desmarcados voltavam marcados após um erro; o resumo da renovação aparecia junto do formulário (agora o substitui); radios sem `name`; singular errado ("Estas data não coube") com textos puros testados; a interface também confere o papel (defesa em profundidade).
- **Aceitos, sem mudança:** o código das telas de série vai no bundle JS do profissional (é código, não dado); a prévia de 60 datas é longa no celular (agora rola até ela, e o resumo fica no topo).
