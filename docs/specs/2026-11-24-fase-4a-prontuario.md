# Spec — Fase 4A: prontuário em texto (evolução, adendo e log de acesso)

**Status:** aguardando aprovação do usuário (2026-11-24); passou por uma leitura independente de "construtor" e as dúvidas dela estão resolvidas em "Decisões de detalhe". **Plano:** ainda não escrito. A Fase 4 do PRD ("Prontuário: evolução em texto, anexos, auditoria") é entregue em duas partes: **4A (esta: texto, trava e log)** e **4B (anexos, Storage e prova do consentimento; spec própria depois)**.

## Contexto e porquê
Hoje a clínica tem **um** profissional e ele guarda tudo no próprio celular; não há fluxo antigo a copiar. O objetivo da 4A é dar a esse profissional (e aos próximos) um lugar seguro, dentro do sistema, para escrever a evolução de cada atendimento realizado, com o sigilo que a lei e o PRD exigem: **só quem escreveu lê** (mais o admin, com registro), a recepção nem sabe que existe, e o que foi finalizado não muda nem some em silêncio. A 4A vem antes dos anexos para que o log de acesso e as regras de sigilo já estejam prontos e testados quando o primeiro arquivo entrar (4B).

## Decisões do usuário
| Tema | Decisão |
|---|---|
| Ordem | **4A (texto) primeiro, 4B (anexos) depois** |
| Quem lê | **Só o profissional que escreveu** (e o admin). Mesmo que fisioterapeuta e psicóloga atendam o mesmo paciente, uma **nunca** vê o que a outra escreveu. A mesma regra vale para os anexos da 4B |
| Correção | Rascunho livre; ao **finalizar** o texto fica trancado pelo banco; correção só por **adendo** (autor e data, original intacto) |
| Recepção | Nenhum acesso, nem à existência da evolução |
| Admin | Lê tudo (PRD), **não escreve** evolução de ninguém; cada leitura é registrada |
| Log | Toda leitura e gravação por admin ou profissional entra numa tabela **só de inclusão**; o texto clínico **nunca** vai para o log |
| Como garantir o log | **Abordagem A:** o app grava o log **na mesma transação** da leitura e um teste falha se algum código ler sem registrar (o banco não impõe a leitura com log: risco baixo, porque o app é o único caminho, com a Data API desligada). Migrar para leitura só por função do banco (abordagem B) fica possível depois sem refazer as tabelas |

## Abordagens consideradas
- **A (escolhida):** três tabelas de "só acrescentar" (evolução, adendo, log); a RLS impõe o sigilo; o log de leitura é do app, com teste. Segue o padrão do projeto; simples de testar.
- **B (descartada por ora):** leitura só por função do banco que registra sozinha. Garantia total do log, mas mais SQL à mão, foge do padrão e é exagero para um consultório.
- **C (descartada):** cada edição vira uma versão. Pede telas de comparação que o PRD não exige; o adendo já cobre a correção.

## Objetivos
- O profissional escreve a evolução de um atendimento **Realizado** dele, salva como rascunho quantas vezes quiser e finaliza.
- Depois de finalizada, a evolução só recebe **adendos** (nova nota com autor e data); ninguém edita nem apaga o original, nem o próprio autor, nem o admin.
- O histórico do paciente aparece em ordem cronológica numa seção "Prontuário" da ficha, para o profissional (só o dele) e o admin (de todos).
- Todo acesso fica registrado, e esse registro também não se edita nem se apaga.

## Fora desta fase (YAGNI)
Anexos, fotos e PDFs (4B); prova do consentimento (4B); modelos/templates por especialidade e odontograma (PRD: versões futuras); texto formatado (só texto simples); salvamento automático; busca dentro das evoluções; evolução de atendimento que não é **Realizado** (falta, cancelado, agendado); tela para o admin consultar o log (a tabela fica legível ao admin por SQL; a tela vem depois); exportar ou anonimizar (PRD: retenção adiada); apagar rascunho; assinatura digital; qualquer indicador de "tem evolução" na agenda ou na lista de pacientes.

## Anti-objetivos (seria falha mesmo que "funcione")
- Um profissional ler (ou saber que existe) a evolução de outro, inclusive quando o paciente é vinculado a ambos.
- A recepção ler, ou inferir pela tela, que há evolução.
- Texto clínico em log, URL, mensagem de erro, parâmetro de consulta, cache compartilhado ou resposta de erro.
- Evolução finalizada alterada ou apagada por qualquer papel do app.
- Leitura de evolução sem linha no log.

## Restrições (regras do projeto que valem aqui)
Toda tabela: `.enableRLS()`, `REVOKE` de `anon`/`PUBLIC`, `GRANT` mínimo, política `RESTRICTIVE` de `aal2`, teste de RLS por perfil e teste do **gatilho sozinho** (privilégio dado e RLS desligada num savepoint desfeito). Acesso só por `withUser`; resultados são **valores** (nunca erro do banco); mensagens fixas em pt-BR; toda Server Action chama `requireRole`; migrações novas (0034 em diante) só no Supabase dev, ensaiadas numa transação desfeita antes; nunca editar migração aplicada. Sem dado real. Sem serviço externo.

## Modelo
- **`clinical_notes`** (a evolução): `id`, `appointment_id` (**único**: uma evolução por atendimento), `patient_id`, `professional_id`, `body` (texto, 1 a 20 000 caracteres, nunca vazio: a linha só nasce no primeiro salvamento com texto), `status` (`draft | finalized`), `finalized_at`, `finalized_by`, `created_at`, `updated_at`. **FK composta** `(appointment_id, patient_id, professional_id)` para o atendimento (o banco garante que paciente e profissional são os do atendimento; exige uma chave única nova em `appointments`, na migração).
- **`clinical_note_addenda`** (a correção): `id`, `note_id`, `body` (1 a 20 000), `created_by`, `created_at`; **só `SELECT` e `INSERT`**.
- **`clinical_access_log`** (o registro): `id`, `at`, `user_id`, `role`, `action` (`read_note | read_history | create_note | update_draft | finalize | add_addendum`), `patient_id`, `note_id` (opcional); **só `SELECT` (admin) e `INSERT`**; sem coluna de texto.
- **RLS de leitura:** `clinical_notes` e `clinical_note_addenda`: **admin** lê tudo; **profissional** lê só onde o `professional_id` é o cadastro **ativo e não removido** ligado ao login dele (**pelo autor da nota, nunca pelo vínculo paciente↔profissional**); **recepção sem política**. O log é legível só pelo admin.
- **RLS de escrita:** só o profissional autor insere e atualiza; admin e recepção **não gravam** evolução nem adendo. O log aceita `INSERT` do próprio usuário (`user_id = auth.uid()`, `role` vindo do banco), nunca de outro.
- **Gatilhos:** `BEFORE INSERT` em `clinical_notes` exige que o atendimento esteja **Realizado** e seja do profissional logado e cria sempre como `draft`; `BEFORE UPDATE` só permite `draft → draft` (muda o texto), `draft → finalized` (o banco carimba `finalized_at` e `finalized_by`) e **trava** a nota finalizada (nada muda); `appointment_id`, `patient_id`, `professional_id` e `created_at` são imutáveis. Adendo só entra em nota `finalized` do próprio autor; `created_by` e `created_at` vêm do banco.
- **Sem `DELETE` para ninguém** nas três tabelas (e sem `UPDATE` em adendo e log).

## Camada de dados e telas
- **`src/server/clinical/`** (só `withUser`): `queries.ts` (histórico do paciente e leitura de uma evolução: cada função **grava o log na mesma transação**), `mutations.ts` (criar rascunho, salvar, finalizar, adicionar adendo: devolvem um valor `not-found | not-realized | locked | empty | denied...`, com log), `actions.ts` (`requireRole("professional")` para escrever; `requireRole("admin","professional")` para ler), `messages.ts`. Só esse diretório importa as tabelas clínicas; um teste falha se outro arquivo as importar ou se uma consulta exportada não registrar o log.
- **Regras puras** em `src/lib/clinical/` (Zod: texto normalizado, limites; ações do log), testadas.
- **Tela:** seção **"Prontuário"** na ficha `/pacientes/[id]`, **só renderizada para admin e profissional** (a recepção nem consulta). O profissional vê **os atendimentos Realizados dele com este paciente**: os sem evolução trazem "Escrever evolução"; os com rascunho trazem "Continuar"; os finalizados mostram o texto, os adendos e "Adicionar adendo". O admin vê todas as evoluções do paciente, somente leitura, com o nome do profissional autor. Gaveta de escrita no padrão do projeto, mobile-first, texto simples. Confirmação antes de **Finalizar** deixando claro que não dá para editar depois.
- Nada de dado clínico em URL, `searchParams`, cache, `revalidate` com conteúdo ou log. Rota nova (se houver) registrada em `src/lib/auth/access.ts`.

## Testes (obrigatórios)
- **RLS por perfil** (modelo `waitlist-rls*.test.ts`): admin lê tudo e não grava; recepção não lê nem grava; profissional autor lê e escreve só o que é dele; **segundo profissional vinculado ao mesmo paciente não lê nada** (nem nota, nem adendo); profissional inativo ou removido perde o acesso; `aal1` recusado; `service_role` sem escrita; sem `DELETE`.
- **Gatilho sozinho:** não cria em atendimento que não é Realizado nem de outro profissional; não altera finalizada (nem o autor, nem o dono do banco pelo app); transições permitidas e proibidas; colunas imutáveis; adendo só em finalizada; `finalized_*` e `created_*` vêm do banco.
- **Camada de dados contra o dev:** fluxo completo (criar, salvar, finalizar, adendar), `locked` após finalizar, corrida salvar × finalizar, e **uma linha de log por leitura e por gravação** (sem texto nela).
- **Guarda do log:** falha se alguém ler as tabelas clínicas fora de `src/server/clinical/` ou se uma consulta exportada não registrar.
- **Componente e e2e (desktop e celular):** profissional escreve, finaliza e adenda; recepção não vê a seção; **o segundo profissional não vê a evolução do primeiro**; admin lê e não vê botão de escrever.
- **Verificação:** `pnpm lint && pnpm typecheck && pnpm test` e `pnpm test:e2e`; revisão independente obrigatória (RBAC, RLS, dado clínico).

## Decisões de detalhe (minhas, a conferir)
Fechadas depois da leitura de um revisor independente; nenhuma muda o que você decidiu acima.
1. **Realizada que vira Falta:** só o **admin** consegue (`status.ts`; Realizada nunca vira Cancelada). Nesse caso a evolução **continua válida** (o que foi escrito é histórico verdadeiro) e **o gatilho da agenda não muda**. A lista do profissional mostra os atendimentos dele **com evolução (qualquer status) ou Realizados sem evolução**, para a nota não sumir da tela. Um Realizada marcado por engano, com evolução já finalizada, é corrigido pelo admin como hoje; o adendo explica.
2. **Rascunho e admin:** o admin lê **também os rascunhos** dos outros (PRD: "acesso a tudo"), marcados como "Rascunho" e com a mesma regra de log.
3. **Granularidade do log:** **uma linha por evolução cujo texto foi devolvido** (`read_note`), mais uma linha `read_history` por abertura do histórico. A seção do histórico carrega junto com a ficha (sem clique extra), então abrir a ficha como admin ou profissional grava linhas; recepção não grava, porque nem consulta. O teste de guarda confere "N textos devolvidos, N linhas".
4. **Quem grava no log:** só **admin e profissional**, com `user_id = auth.uid()` e `role` preenchido pelo banco (não pelo cliente); `note_id`, quando vem, tem de ser de uma evolução que a pessoa enxerga. A recepção e o `aal1` não inserem.
5. **Prazo:** sem limite de tempo nem de data retroativa. Escrever dias depois é normal; o `created_at` do banco mostra quando foi escrito.
6. **Sem rascunho vazio:** "Escrever evolução" abre o formulário **sem criar linha**; a linha nasce no **primeiro salvamento com texto** (`CHECK` de texto não vazio em qualquer status). Assim não sobram rascunhos vazios que ninguém pode apagar, e `create_note` entra no log nesse momento. (Isto troca a regra anterior de "só rascunho pode estar vazio".)
7. **e2e:** estender o cenário para ter um **segundo profissional vinculado ao mesmo paciente** está **dentro do escopo** (é a prova do anti-objetivo principal).

## Deixado ao construtor
Divisão em tarefas, limites exatos de texto, rótulos pt-BR, layout da seção e da gaveta, índices, nomes dos arquivos, se o log guarda o IP (não: sem PII extra) e como ordenar o histórico.

## Entrega
Branch `feat/fase-4a-prontuario`; o usuário faz commit/PR e merge. Ao final, atualizar `docs/PRD.md` (4.4: evolução e log feitos, anexos na 4B), `AGENTS.md` ("Instalado (Fase 4A…)") e `docs/STATUS.md`.

## Como ficou
**Status:** implementada em `feat/fase-4a-prontuario` (2026-11-24), aguardando commit, PR e merge do usuário. Plano: `docs/plans/2026-11-24-fase-4a-prontuario.md` (T1 a T9 feitas).

- **Banco (migrações 0034 a 0038, só no Supabase dev):** 0034 tabelas, enums e `appointments_identity_uq` (alvo da FK composta); 0035 grants, leitura e `aal2`; 0036 escrita e os três gatilhos; **0037 e 0038 são correções achadas na revisão** (a 0036 já estava aplicada): `CHECK` de que só `read_history` vale sem evolução, e a política de INSERT do log passou a aceitar também o paciente de quem o autor tem evolução.
- **Decisão que o plano deixava aberta: o acesso é pelo AUTOR, nunca pelo vínculo.** Desvincular ou remover o paciente não tira a evolução do autor no banco (teste), e o admin continua lendo.
- **Camada de dados** (`src/server/clinical/`): `getPatientRecord` (null para a recepção, sem tocar no banco), `saveNote` / `finalizeNote` / `addAddendum` (valores, nunca erro do banco; `23505` do 1º salvamento disputado vira `busy`), `recordAccess` na mesma transação (falha fechada: log recusado = nada devolvido; teste cobre). Guarda textual em `access-guard.test.ts` (nomes de tabela em camelCase e em SQL; toda função exportada de `queries.ts` e `mutations.ts` chama `recordAccess`).
- **Tela:** seção "Prontuário" na ficha, fora do bloco `isStaff`, só para admin e profissional; gaveta de texto compartilhada (evolução e adendo, o texto digitado volta em erro), finalizar com confirmação que avisa que o texto fica trancado.
- **Revisões independentes (3):** (1) leitura do desenho por um "construtor" (7 dúvidas, todas resolvidas em "Decisões de detalhe"); (2) RLS e gatilhos, **nenhum achado crítico**, 2 importantes: log recusado para autor desvinculado (**corrigido**, 0038) e relink de login (**aceito**, abaixo); minors corrigidos: `CHECK` do log (0037) e testes (autor com `aal1`, `ON CONFLICT DO UPDATE`, B × nota de A com `apB`, `finalized_at` forjado); (3) branch final, **nenhum achado crítico**, 1 importante **corrigido**: o `innerJoin` com `services` fazia a evolução do profissional sumir se o serviço fosse removido (a RLS esconde serviço removido dele); agora `leftJoin` com o rótulo "Serviço removido" e teste. Também corrigidos: mensagem de "caracteres invisíveis ou de controle" e guarda ampliado; teste de falha fechada do log.
- **Aceito, sem correção (decisão do dono pendente):** quem o admin ligar ao cadastro de um profissional (`professionals.profile_id`) passa a ler as evoluções antigas dele. O admin já lê tudo, então não é escalada de privilégio, mas é uma troca de "dono" do prontuário; se o login de um profissional puder mudar de pessoa, vale bloquear a troca de login enquanto houver evolução.
- **Limites conhecidos:** (a) um profissional desvinculado do paciente (ou com o paciente removido) ainda **lê no banco** as próprias evoluções, mas a ficha dele dá "não encontrado": não há tela "meus prontuários" (futuro); (b) **inflação do log:** toda ação revalida a ficha, que se reabre e grava `read_history` + um `read_note` por evolução mostrada (a granularidade é a da decisão 3; se pesar, uma janela curta de deduplicação); (c) tentativas recusadas (`locked`, `not-found`) não vão para o log (só o acesso que deu certo); (d) a gaveta não tem contador do limite de 20 000 caracteres (o erro vem ao salvar e o texto não se perde); (e) o `DETAIL` de uma violação de `CHECK` no Postgres inclui a linha com o texto: o app nunca o repassa nem o loga (o Zod barra antes e o erro vira um valor fixo); (f) **e2e:** só há um login de profissional por projeto, então "o outro profissional não lê" é provado no banco com dois logins reais (`clinical-rls*.test.ts`) e, no e2e, com a evolução do colega semeada pelo dono; (g) o caso da recepção entrou em `clinical-record.spec.ts`, não em `rbac.spec.ts`.
- **Desvios do plano:** atendimentos Realizados dos testes de dados ficam em **2026-02** (passado) e só o agendado em 2031-10 (a regra da agenda exige início passado para Realizada); os e2e foram escritos **depois** da tela (as regras de fundo foram todas RED antes).
- **Verificação (2026-11-24):** `lint`, `typecheck` e `build` limpos; **105 arquivos e 2141 testes verdes** (89 do prontuário no banco: 71 de RLS de escrita, 18 de dados; mais RLS de leitura, ações, componentes e guarda); **e2e completo: 174 passaram, 63 pulados de propósito, 0 falharam** (18,3 min) e, depois das últimas correções, `clinical-record.spec.ts` de novo 15 passaram. **Não feita:** conferência manual no navegador com login e 2FA reais.
