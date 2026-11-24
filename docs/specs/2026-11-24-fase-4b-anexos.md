# Fase 4B — Anexos do prontuário e prova do consentimento (spec)

**Status:** aprovada pelo usuário em 2026-11-24 (plan mode). **Plano da 4B-1:** `docs/plans/2026-11-24-fase-4b1-anexos-prontuario.md`. Entregue em duas partes: **4B-1 (anexos do prontuário)** e **4B-2 (prova do consentimento, plano próprio depois do merge da 4B-1)**. Spec da 4A: `docs/specs/2026-11-24-fase-4a-prontuario.md`.

## Context
A 4A entregou a evolução em texto com acesso **só pelo autor**, admin só leitura e log de acesso. A 4B completa a Fase 4 do PRD (4.4: "anexos por paciente/consulta") e fecha a pendência do STATUS ("anexo da prova do consentimento"). Hoje o profissional guarda exames e fotos no próprio celular; o objetivo é um lugar seguro dentro do sistema, com a **mesma regra de sigilo**: cada profissional lê **só o que anexou** (psicóloga e fisioterapeuta no mesmo paciente nunca veem os anexos uma da outra); o admin lê tudo com log, sem anexar; a recepção não tem acesso a anexo clínico.

## Decisões do dono (esta sessão)
| Tema | Decisão |
|---|---|
| Ligação do anexo | **Ao paciente, com atendimento Realizado opcional** (exame trazido fora de consulta também entra) |
| Escopo | **Junto na 4B, em dois planos:** 4B-1 anexos do prontuário; 4B-2 prova do consentimento (admin e recepção anexam e leem; profissional nunca vê) |
| Caminho do arquivo | **Pelo nosso servidor** (limite prático ~4 MB, teto da Vercel; foto do celular é reduzida no navegador; nenhum link do Storage chega ao navegador; CSP não muda) |
| Sigilo | Herdado da 4A: autor lê, admin lê com log, recepção nada |

## Minhas chamadas (o dono corrige se discordar)
- **Tipos aceitos:** PDF, JPEG, PNG, WebP. Sem HEIC, SVG, HTML ou Office (SVG/HTML executam script). O tipo é decidido pelos **primeiros bytes** do arquivo no servidor, nunca pelo que o navegador diz nem pela extensão.
- **Tamanho:** até **4 MB** por arquivo, conferido no navegador, na ação e no banco (CHECK) e no bucket (`file_size_limit`).
- **Remover = lógico:** o autor "remove" (`removed_at/removed_by`, trava no banco); o arquivo **nunca** é apagado do Storage (dado clínico não some em silêncio) e o admin ainda enxerga o removido, marcado. Existe porque anexar no paciente errado é o erro mais provável.
- **Sem miniatura:** cada abertura grava `read_attachment` no log; miniatura na lista inflaria o log. Imagem abre numa aba; PDF baixa (`Content-Disposition: attachment`).
- **Nome do arquivo é texto sensível:** só aparece na ficha de quem pode ler; nunca em URL, log, erro nem caminho do Storage (o caminho é só UUID).
- **Um único log:** `clinical_access_log` ganha as ações `upload_attachment`, `read_attachment`, `remove_attachment` e a coluna `attachment_id`; a listagem de anexos entra no mesmo `read_history` que a 4A já grava (`getPatientRecord` passa a devolver `attachments`).
- **Interface de storage** (PRD 6.1): `src/server/storage/` com `AttachmentStore` (`put`, `get`), driver Supabase e um **falso em memória** para testes; só `src/server/clinical/` pode importá-lo (guarda de teste).

## Abordagem técnica (4B-1)
**Sem chave secret:** o servidor fala com o Storage usando o **JWT do usuário** (cliente `createSupabaseServerClient`, publishable key). Quem decide é a **RLS de `storage.objects`**, que consulta as nossas tabelas.

**Dados (migrações 0039 em diante, só no Supabase dev; `pnpm db:generate`, `--custom --name=…` para SQL à mão):**
- `clinical_attachments`: `id`, `patient_id`, `professional_id` (autor), `appointment_id` null (FK composta `(appointment_id, patient_id, professional_id)` → `appointments_identity_uq`; com `appointment_id` nulo o Postgres não confere, que é o desejado), `storage_path` único (`<uuid>`, sem PII), `original_name` (CHECK 1–120, texto de exibição), `content_type` (CHECK na lista), `size_bytes` (CHECK 1–4 194 304), `sha256` (CHECK 64 hex), `created_at`, `removed_at/removed_by` (CHECK de par). `.enableRLS()`, REVOKE de `anon`/`PUBLIC`, `GRANT SELECT, INSERT` + `UPDATE (removed_at, removed_by)`, `service_role` sem escrita, política `RESTRICTIVE` `aal2`.
- Políticas: select `admin` e `autor` (mesmo `EXISTS` em `professionals` da 4A); insert só do autor (gatilho `BEFORE INSERT` devolve `42501` a quem não pode e confere atendimento Realizado dele, quando informado); gatilho `BEFORE UPDATE`: só `removed_*`, só pelo autor, uma vez, carimbo `auth.uid()`/`now()`; **sem DELETE**.
- Log: novo enum de ações + `attachment_id` (FK) e **troca do CHECK** `clinical_access_log_note_check` por um que exige `note_id` nas ações de nota, `attachment_id` nas de anexo e nenhum nas de histórico; a política de insert do log passa a conferir também o anexo que a pessoa enxerga (nova migração, nunca editar a aplicada).
- Storage (migração própria): bucket **privado** `clinical-attachments` (`file_size_limit` e `allowed_mime_types` por defesa em profundidade) e políticas em `storage.objects`: `INSERT` para profissional ativo no bucket; `SELECT` só se existir linha visível em `clinical_attachments` com aquele `storage_path` (reusa a RLS da tabela); `DELETE` só do próprio órfão (`owner_id = auth.uid()` e sem linha), para a compensação; restritiva `aal2`. Sem UPDATE.

**Servidor (`src/server/clinical/`, `src/server/storage/`):**
- `uploadAttachment(user, {patientId, appointmentId?, file, name})`: valida (Zod + bytes + 4 MB) → `store.put` em `<uuid>` → numa transação `withUser` insere a linha + `recordAccess(upload_attachment)`; se o banco falhar, apaga o objeto órfão (melhor esforço) e devolve valor (`denied`, `not-found`, `not-realized`, `too-large`, `bad-type`, `busy`), nunca erro cru.
- `removeAttachment(user, {attachmentId})`: `UPDATE ... WHERE removed_at IS NULL` + log.
- `openAttachment(user, attachmentId)`: transação com `select` (RLS) + `recordAccess(read_attachment)` **antes** de entregar (falha fechada); depois `store.get` com o JWT.
- Entrega por **Route Handler** `GET` (sob `(app)`): `requireRole("admin","professional")`, resposta com `Content-Type` guardado, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, nome seguro no `Content-Disposition`. Envio por **Server Action** (`requireRole("professional")`, admin não anexa) com `bodySizeLimit` ~5 MB; **consultar `node_modules/next/dist/docs/` antes** (AGENTS: este Next tem API diferente).
- Guardas de teste: `access-guard.test.ts` passa a cobrir `clinicalAttachments` e a exigir `recordAccess` em toda função nova; outro teste falha se algo fora de `src/server/clinical` importar `@/server/storage`.

**Tela:** cartão **Anexos** na ficha (junto do Prontuário; só admin e profissional). Profissional: "Anexar arquivo" (gaveta com arquivo, descrição curta opcional e atendimento Realizado opcional; foto >1,5 MB reduzida no navegador para ≤2000 px, JPEG), lista própria com Abrir/Baixar e Remover (com confirmação). Admin: lista somente leitura com o nome do autor e removidos marcados. Recepção: nada.

## Fora de escopo da 4B-1
Miniaturas e visualizador de PDF no app; vários arquivos de uma vez; HEIC; busca; apagar fisicamente; backup do Storage (PRD, seção 5, fica com o backup); tela do log; **4B-2** (prova do consentimento: tabela própria ligada a `patient_consents`, bucket próprio, só admin e recepção, mesma interface de storage; log e regras definidos na spec dela).

## Riscos conhecidos
- Teto de ~4 MB: PDF maior não entra (decisão do dono; trocar para envio direto no futuro é possível porque o acesso passa pela interface de storage).
- Troca de login de um profissional (pendência da 4A) vale igual para anexos: quem for ligado ao cadastro lê os anexos antigos.

## Resultado do spike (T1, 2026-11-24)
Somente leitura e transação desfeita no dev: `storage.objects` e `storage.buckets` pertencem a `supabase_storage_admin` com RLS ligada, **sem nenhum bucket nem política** ainda; o `postgres` (dono das migrações) **consegue** inserir o bucket e criar política em `storage.objects` (provado e revertido); `authenticated` já tem `INSERT/SELECT/UPDATE/DELETE` nessa tabela (padrão do Supabase), então a barreira é só a RLS: **por isso a política restritiva `aal2` e a ausência de UPDATE/DELETE livres valem aqui**. **Ainda não provado:** o caminho HTTP (upload/download com o JWT do usuário); é provado pelo driver (T6) e pelo e2e com Storage real (T10). Se falhar, voltar ao dono.

## Como ficou (4B-1, 2026-11-24)
**Entregue:** `clinical_attachments` e o cartão "Anexos" na ficha (só admin e profissional). Migrações **0039 a 0045**, só no Supabase dev: 0039 tabela + ações novas no log + CHECK de alvo; 0040 grants, leitura e `aal2`; 0041 escrita, gatilhos e política do log estendida; 0042 bucket + políticas de `storage.objects`; 0043 correção do "órfão"; 0044 índice único contra duplicata; 0045 endurecimentos da revisão. Código: `src/lib/attachments/`, `src/server/storage/`, `src/server/clinical/{attachments,attachment-actions,attachment-open,author}.ts`, a rota `GET /pacientes/[id]/anexos/[attachmentId]`, `src/components/clinical/{attachments-section,attachment-sheet,remove-attachment-button}.tsx`, `e2e/clinical-attachments.spec.ts`.

**Diferenças em relação ao plano (decisões da execução):**
- **Descrição opcional** do anexo ficou de fora (YAGNI): só o nome do arquivo.
- **Duplicata:** índice único parcial (paciente + autor + hash, enquanto não removido) para pegar duplo clique e corrida; o mesmo arquivo pode voltar depois de removido (`0044`).
- **Anexo removido:** a RLS da tabela continua deixando o AUTOR ler a linha (acesso é pelo autor); quem esconde é o app (lista e `openAttachment`) e o **Storage** (só o admin lê o arquivo de anexo removido).
- **Rota** em `/pacientes/[id]/anexos/[attachmentId]` e `openAttachment` recebe `patientId` e `attachmentId` (o anexo só abre pelo paciente a que pertence).
- **`attachment-open.ts`** liga a rota ao Storage para que só `src/server/clinical` o importe (guarda `storage-guard.test.ts`); `author.ts` guarda o que a 4A e a 4B dividem (`Abort`, `authorOf`).
- **Teste de gatilho "sozinho":** passou a usar **tabela temporária** com os mesmos gatilhos. `alter table ... disable row level security` e `create policy` na tabela real pedem ACCESS EXCLUSIVE e, com os arquivos de RLS segurando transações abertas, travavam as outras suítes (SQLSTATE 55P03, falhas diferentes a cada rodada). Os três testes equivalentes da 4A (`clinical-rls-write.test.ts`) foram convertidos igual; os de `waitlist-rls-write` e `appointment-series-rls-write` ainda usam o padrão antigo e **não** travam hoje (nenhuma outra suíte grava nessas tabelas dentro de transação aberta), mas valem a mesma troca se aparecer flakiness.

**Spike (T1) fechado:** o caminho HTTP funciona com o JWT do usuário e a publishable key: upload, download e a remoção do envio órfão pela API (o Storage grava `owner_id` a partir do `sub`); provado no e2e (o objeto do envio duplicado foi desfeito: ficaram só os 3 enviados com sucesso).

**Revisões independentes:**
1. *RLS, gatilhos e Storage (0039 a 0044):* nenhum achado crítico; sem caminho para um profissional ler, remover, reapontar ou sobrescrever o anexo de outro. **Importante, corrigido:** o cenário de teste reutilizava o mesmo hash e quebrava com o índice da 0044 (hash por anexo). **Endurecimentos feitos (0045):** o log só aceita `upload_attachment`/`remove_attachment` de quem de fato enviou/removeu (e nunca o admin); o INSERT no Storage exige `owner_id` = o próprio login; o bucket é forçado a privado/4 MiB/4 tipos. **Aceitos:** a linha não é amarrada ao objeto (hash, tamanho e tipo vêm do servidor; um profissional escrevendo direto na Data API poderia mentir, risco baixo e só sobre o que é dele); qualquer profissional ativo pode enviar objetos sem registrar direto ao Storage (ilegíveis para todos, até 4 MiB e 4 tipos; **falta uma rotina de limpeza de órfãos**, pendência abaixo); a função `app.clinical_attachment_path_registered` é executável por `authenticated` (necessário às políticas) e só vira oráculo de existência de UUID adivinhado **se o schema `app` estiver exposto na API do Supabase: conferir no painel na criação da produção** (o padrão é expor só `public`).
2. *Camada de aplicação (branch inteira):* nenhum achado crítico nem caminho para não-autor, recepção ou `aal1` obter bytes, metadados ou sinal de existência. Ajustes: ver "Ajustes da revisão final" abaixo.

**Limites conhecidos (aceitos):**
- Teto de **4 MiB** (Vercel limita o corpo a 4,5 MB); `serverActions.bodySizeLimit` é **global** (5 MB para toda ação; o Next lê o corpo antes de `requireRole`).
- Sem miniatura nem visualizador de PDF; cada abertura grava `read_attachment`; abas/visualizadores que repetem o GET inflam o log (como a re-renderização inflava o `read_history` na 4A). A lista não grava log por arquivo (o nome aparece no `read_history`).
- Tentativas negadas não geram linha de log (igual à 4A).
- O e2e deixa 2 ou 3 arquivinhos fictícios por projeto no bucket de DEV (só a API do Storage os apaga e o e2e não tem chave secret); esvaziar o bucket `clinical-attachments` no painel do Supabase DEV de vez em quando.
- O e2e do admin prova a ordem "log antes de entregar" (o arquivo semeado não existe: 503) e a lista; que o admin recebe os bytes está provado só pela política de `storage.objects` por SQL e pelo e2e do profissional.
- Depois de um erro do servidor o formulário limpa o arquivo escolhido (o React reinicia formulários não controlados): é só escolher de novo.
- A pendência da 4A vale igual: quem o admin ligar ao cadastro de um profissional lê também os anexos antigos dele.
