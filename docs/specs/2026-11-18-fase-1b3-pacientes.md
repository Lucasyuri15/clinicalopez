# Spec — Fase 1B-3: Pacientes

**Status:** aprovada pelo usuário em 2026-11-18 (plan mode). **Plano:** `docs/plans/2026-11-18-fase-1b3a-pacientes.md`.

## Contexto
A 1B-2b (grade de horários) está na `dev` (PR #12). Falta o último cadastro da 1B: **pacientes**, a etapa mais sensível (dado pessoal e de saúde, LGPD). PRD 4.1: nome, CPF, nascimento, contato, endereço, convênio, observações administrativas, consentimento LGPD (e, em 4.3, consentimento para mensagens por WhatsApp). PRD 3 e 8: recepção gerencia pacientes e **não** acessa prontuário; profissional só os **próprios** pacientes; admin tudo.

Ordem da 1B: 1B-1 ✅ → 1B-2a ✅ → 1B-2b ✅ → **1B-3** (fatiada em **1B-3a** cadastro e **1B-3b** consentimentos).

## Decisões do usuário
| Tema | Decisão |
|---|---|
| "Próprio paciente" | **Vínculo explícito paciente↔profissional** (um paciente pode ter vários profissionais). Admin e recepção definem. A agenda (fase 2) poderá criar o vínculo sozinha no primeiro agendamento. |
| Campos do profissional | **Clínico-básico**: nome, nascimento, telefone e e-mail. **CPF, endereço, convênio, responsável e observações** ficam numa tabela só de admin e recepção (o profissional nunca vê convênio, coerente com a 1B-1). |
| Consentimento LGPD | **Histórico de eventos** (só inclusão), dois tipos: tratamento de dados e mensagens por WhatsApp; concedeu/revogou, data e quem registrou. (**1B-3b**) |
| Menores | **Responsável opcional** no cadastro (tabela administrativa); a tela pede o responsável quando o paciente tem menos de 18 anos. |
| CPF | **Obrigatório e único**, com dígitos verificadores. Caixa **"Sem CPF"** libera um campo de **motivo obrigatório** (admin ou recepção preenche), pensado para estrangeiros. |

## Decisões técnicas
- **Modelo** (todas com `enableRLS`, `REVOKE` de `anon`/`PUBLIC`, `aal2` RESTRICTIVE, papel por `app.current_app_role()`):
  - `patients`: `id`, `full_name` (1–120, sem espaço nas pontas), `birth_date` (`date`, entre 1900-01-01 e hoje), `phone` (só dígitos), `email` opcional, `active` (inativo = não atende mais, continua visível), `deleted_at` (remoção lógica, como nas outras tabelas), `created_at`, `updated_at`.
  - `patient_private` (1:1, PK = `patient_id`): `cpf` (11 dígitos) **ou** `no_cpf_reason` (exatamente um dos dois; motivo 1–200 sem espaço nas pontas), endereço, `insurance_id` (opcional) e `insurance_card`, responsável (`guardian_name`, `guardian_relationship`, `guardian_phone`, `guardian_cpf` opcional), `admin_notes` (≤ 1000; a tela avisa para **não registrar dado clínico**).
  - `patient_professionals`: (`patient_id`, `professional_id`) únicos; o profissional vinculado precisa estar ativo e não removido.
  - `patient_consents` (**1B-3b**): só inclusão, sem UPDATE e sem DELETE para ninguém.
- **CPF único** por índice único em `patient_private(cpf)`, **inclusive de pacientes removidos** (reativar é o caminho; o dado fica retido pela LGPD).
- **Quem escreve:** admin e recepção criam, editam e inativam; **só o admin remove** (soft delete). Profissional só lê `patients` e `patient_professionals` do vínculo dele; **nunca** `patient_private` nem consentimentos. A escrita de quem não pode falha sempre com 42501, antes de qualquer constraint (nada vaza por erro de duplicidade).
- **Gravação atômica:** paciente + dados administrativos + vínculos numa transação; substituir o conjunto de vínculos com trava por paciente (`pg_advisory_xact_lock`), como no `saveWeek`.
- **Sem dado sensível em logs, URLs e mensagens de erro** (CPF, telefone, nome): erros citam o campo, nunca o valor.
- **Auditoria de acesso ao cadastro:** fora desta fase (o PRD exige log para **prontuário**, fase 4).

## Fora do escopo
Prontuário e anexos (fase 4); agenda e lista de espera (fase 2); WhatsApp (fase 6); importação em massa; exclusão física; direitos do titular (exportar/anonimizar), registrados como **pendência LGPD**; `created_by`/`updated_by`.

## Como ficou (1B-3a)
- **Migrações 0017 a 0020, só no Supabase dev.** 0017 (DDL: tabelas, checks, índice único do CPF), 0018 (grants, função `app.is_own_patient`, políticas), 0019 (`UPDATE` só nas colunas editáveis: sem trocar `id`/`patient_id`/`created_at`, o que permitiria à recepção mover CPF e endereço de um paciente para outro) e 0020 (endurecimentos do revisor: a função também exige `aal2`; a política dos próprios vínculos repete `deleted_at is null` do paciente).
- **Função `app.is_own_patient(uuid)`** (`SECURITY DEFINER`, `search_path` vazio, só para `authenticated`): confirma o vínculo do PRÓPRIO usuário logado. Existe para a política de `patients` não ler `patient_private`/`patient_professionals` por RLS (a política de vínculos lê `patients`: sem a função o Postgres recusaria a recursão entre políticas).
- **Profissional:** lê `patients` só dos vinculados a ele (profissional ativo e não removido, login ativo, 2FA), os próprios vínculos e **nenhuma** linha de `patient_private`. Recepção: lê/edita não removidos, não remove nem restaura (a política exige `deleted_at` nulo no `WITH CHECK`). Admin: tudo.
- **Camada de dados** (`src/server/patients/`): gravação atômica (paciente + dados administrativos + vínculos), trava por paciente (`pg_advisory_xact_lock`), vínculos levados ao novo conjunto **por diferença** (um vínculo com profissional que depois foi desativado continua valendo ao reeditar; a política só deixa CRIAR vínculo com profissional ativo), `duplicate-cpf` como resultado (nunca texto do banco). Busca por nome sem acento (`translate`, sem a extensão `unaccent`) e por CPF (prefixo de 3 ou mais dígitos, só entre quem lê `patient_private`: para o profissional **nunca casa**, então a busca não serve de oráculo de CPF). Lista só com o clínico-básico; até 50 resultados com aviso para refinar.
- **Regras do app** (`src/lib/patients/`): CPF com dígitos verificadores (sequências iguais recusadas), "Sem CPF" ⇒ motivo obrigatório e CPF vazio, menor de 18 anos ⇒ nome, parentesco e telefone do responsável (29/02 completa em 1º/03), **ao menos um contato** (telefone ou e-mail; para menor vale o telefone do responsável), nascimento entre 1900 e hoje em Brasília (`todayBR`), nome e textos sem caractere de controle.
- **Telas:** `/pacientes` (lista, busca, "Novo paciente", ativar/desativar) e `/pacientes/[id]` (admin e recepção: cadastro completo, "Editar", ativar/desativar; admin: "Remover paciente" com confirmação, depois volta à lista; profissional: só o básico, sem botões; paciente alheio ou removido = "Não encontrado"). A gaveta de cadastro devolve o digitado em erro (o React limpa o formulário depois de cada ação; a caixa "Sem CPF" usa `defaultChecked` + `key`, achado do e2e).
- **Mensagem de CPF repetido:** "Já existe um cadastro com este CPF (pode estar removido: procure o administrador)". A recepção não vê removidos, então esta é a única pista de que o CPF já existe.

## Revisões independentes
- **Migração e RLS (T2):** sem achado crítico nem importante. Corrigido (0020 e testes): a função `is_own_patient` também exige `aal2`; a política dos próprios vínculos repete `deleted_at is null`; testes que faltavam (escrita em `patient_private` com `aal1`, recepção criando paciente já removido, admin e recepção desativados escrevendo, chamada direta da função, profissional removendo). Antes da revisão eu mesmo fechei a troca de chaves (0019).
- **Aplicação (T6):** sem achado crítico. **Importantes corrigidos:** (1) erro inesperado do banco relançado com a consulta e os **parâmetros** (CPF, endereço) na mensagem, que iriam ao log do servidor: `withoutQueryDetails` (`src/server/db/pg-error.ts`) nas mutações e consultas de pacientes; (2) a busca por GET punha CPF e nome na URL: agora é Server Action (POST), com o termo só na tela; (3) a mensagem de erro do formulário longo ficava fora de vista (celular): a gaveta rola até ela e leva o foco; (4) e2e agora semeiam **todos** os campos reservados (convênio, carteirinha, endereço, responsável, motivo de não ter CPF) e checam que nenhum chega ao profissional, e há teste no celular. **Menores corrigidos:** byte nulo na busca (500), controles C1 no nome, UUID em maiúsculas (trava e vínculos), `getPatient` só consulta os dados administrativos para admin e recepção (`staff`), props mínimas ao componente cliente, busca junta espaços, "menos de 1 ano" para bebê, "Sem CPF" só abre marcado quando há motivo, teste da trava de verdade (uma edição espera a transação que já segura o paciente), a lista de pacientes sem o botão ativar/desativar (fica no detalhe).
- **Aceitos e registrados:** o formulário aberto e velho regrava por cima de quem editou depois (vale a última gravação, como na 1B-2b); um vínculo com profissional **removido** some em silêncio ao salvar o paciente; um convênio **removido** aparece como "Particular" na edição; as ações de ativar/desativar e remover ignoram o resultado do banco e só revalidam; só o primeiro erro de validação aparece por vez; Esc ou clique fora descarta o formulário sem aviso; o termo digitado enquanto a busca anterior ainda responde é substituído pelo termo enviado; o `translate` de acentos cobre 53 letras do português e comuns estrangeiras.

## Pendências registradas (não são desta fatia)
- **Reativar paciente removido** (só o admin vê removidos; hoje não há tela). O CPF continua reservado. Entra junto com a 1B-3b ou uma fatia curta.
- **Consentimentos LGPD** (1B-3b) e **direitos do titular** (exportar/anonimizar).
- **Auditoria de acesso ao cadastro** (o PRD exige log só para prontuário, fase 4).
- `INSERT` ainda aceita `id`/`created_at` informados por admin e recepção (sem efeito de acesso); restringir por coluna se `created_at` virar trilha de auditoria.
- A inserção em `patient_private` exige paciente não removido até para o admin (o `UPDATE` do admin vale em removido): assimetria intencional, documentada na migração.
- Os testes de RLS demoram (~3 min o arquivo, uma ida ao banco remoto por passo).
