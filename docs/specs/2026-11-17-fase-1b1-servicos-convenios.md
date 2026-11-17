# Spec — Fase 1B-1: Serviços e Convênios

**Status:** aprovada pelo usuário em 2026-11-17 (plan mode). **Plano:** `docs/plans/2026-11-17-fase-1b1-servicos-convenios.md`.

## Contexto
A 1A-3 está concluída (PR #9). A Fase 1B (cadastros, PRD 4.1) foi dividida **do mais simples ao mais sensível**:
1. **1B-1 Serviços + Convênios** (esta spec): sem dado pessoal; fixa o padrão de tabela/RLS/tela.
2. 1B-2 Profissionais + vínculo com usuário + grade de horários.
3. 1B-3 Pacientes (CPF, LGPD, visibilidade por profissional).

A agenda (fase 2) e o financeiro (fase 5) consomem estes cadastros. O PRD marca "duração/regras de horário dos serviços" e "convênios e forma de cobrança" como adiados por falta de dados: a estrutura é completa, os dados reais entram depois (a tela de convênios pode ficar vazia).

## Decisões do usuário
| Tema | Decisão |
|---|---|
| Divisão da 1B | 1B-1 → 1B-2 → 1B-3, uma branch e PR cada |
| Modelo | Estrutura completa (serviços, convênios, valores); dados quando houver |
| Acesso | **Admin** cria/edita/desativa tudo · **Recepção** lê serviços, convênios e valores · **Profissional** lê serviços (nome, especialidade, duração) e **nunca** valores nem convênios |

## Decisões técnicas
- **Valores em tabela própria (`service_prices`), fora de `services`.** A RLS é por linha, não por coluna, e `authenticated` é o mesmo papel para todos: com o valor como coluna de `services`, o profissional o leria. `services` é legível por todos os perfis ativos; `service_prices`, `insurances` só por admin e recepção. **Valor particular = linha com `insurance_id` nulo**; valor de convênio = linha com `insurance_id`.
- **Sem DELETE** para `authenticated`: exclusão lógica (`active` + `deleted_at`), como `profiles`.
- **Auditoria de quem mudou preço fica fora da 1B-1** (só `created_at`/`updated_at`). Um log de auditoria genérico é desenhado na 1B-3/fase 4, junto com o dado clínico.
- **Preço histórico:** ao agendar/cobrar (fases 2 e 5) o valor deve ser **copiado para o atendimento**; o preço de hoje não pode reescrever o histórico.
- **Seed de dev fora** (previsto na 1B-3, com pacientes fictícios): os testes criam e apagam os próprios fixtures.

## Modelo de dados (migrações `0006_catalog.sql` = DDL gerado e `0007_catalog_access.sql` = grants e RLS à mão)
- enum `specialty`: `physiotherapy | dentistry | psychology` (reaproveitado pela 1B-2).
- `services`: `id`, `name` (1–120), `specialty`, `duration_minutes` (smallint, 5–480), `active`, timestamps, `deleted_at`. Único `(specialty, lower(name))` onde `deleted_at is null`.
- `insurances`: `id`, `name` (1–120), `active`, timestamps, `deleted_at`. Único `lower(name)` onde `deleted_at is null`.
- `service_prices`: `id`, `service_id` → `services` (restrict), `insurance_id` → `insurances` (restrict; nulo = particular), `price_cents` (integer, 0–10.000.000), timestamps e **`deleted_at`** (remover um valor é exclusão lógica, coerente com "sem DELETE"). Únicos parciais, só entre os NÃO removidos: `(service_id)` onde `insurance_id is null`; `(service_id, insurance_id)` onde não nulo.
- RLS: `.enableRLS()`; `REVOKE` de `anon`/`PUBLIC`; `GRANT SELECT, INSERT, UPDATE` a `authenticated`; `services` SELECT admin/reception/professional, `insurances` e `service_prices` SELECT admin/reception; INSERT/UPDATE só admin; **política RESTRICTIVE `aal2`** em cada tabela (o teste de catálogo exige).

## Fora do escopo
Profissionais, grade, usuários e pacientes (1B-2/1B-3); auditoria genérica; seed de dev; agenda e cobrança; regras de horário por serviço e forma de cobrança de convênio (PRD: adiadas por falta de dados).

## Diferenças em relação ao plano aprovado (T2)
- **Duas migrações em vez de uma** (`0006` DDL gerado pelo drizzle-kit + `0007` grants e políticas à mão), no mesmo molde de `0000`/`0001` e `0004`/`0005`.
- **`service_prices.deleted_at`:** o plano previa "remover valor" (T4) mas também "sem DELETE"; para as duas coisas valerem, o valor removido é lógico e os únicos parciais ignoram os removidos. Recepção só lê valores não removidos.
- **Testes:** `src/server/db/rls-harness.ts` (apoio compartilhado: transação sempre revertida, usuários fictícios, `attempt` com savepoint que devolve o SQLSTATE) e `catalog-rls.test.ts` (57 testes). `rls.test.ts` (1A-1) não foi tocado; pode migrar para o harness depois.

## Revisão independente da T2 (migração e RLS) e resposta
Subagente adversarial sobre `0006`/`0007`, `schema.ts`, `catalog-rls.test.ts` e `rls-harness.ts`. **Sem achado crítico:** nenhum caminho para profissional, usuário sem perfil/inativo/removido ou JWT `aal1` ler valores ou convênios, nem para ninguém além do admin escrever. Conferiu: combinação de políticas (permissivas em OU, `RESTRICTIVE aal2` em `FOR ALL`), papel nulo nega, sem views/sequências/funções novas, grants só `SELECT/INSERT/UPDATE`, índices únicos parciais com soft delete, intervalos iguais aos do Zod, ordem/jornal das migrações, e que o helper `attempt` (savepoint) de fato desfaz e devolve o SQLSTATE.

**Corrigido (migrações novas, porque 0006/0007 já estavam aplicadas):**
- **I1 — valor visível com o serviço/convênio-pai removido.** `0009`: a recepção só lê o valor se o serviço **e** o convênio (quando houver) estiverem visíveis; o admin não cria valor para pai removido (política de INSERT). O UPDATE fica livre de propósito (o admin precisa poder marcar como removido o valor de um serviço já removido).
- **I2 — faltava provar que a RLS barra ANTES das constraints** (para ninguém sondar dado escondido pelo código do erro). Testes novos: recepção e profissional recebem **42501** em duplicata, valor inválido, chave estrangeira inexistente, convênio removido (que nem enxergam) e `ON CONFLICT`; o mesmo para usuário sem perfil/inativo/removido e para `aal1`.
- **M3 — checks de nome fracos** (`btrim` só tira espaço; o nome era ilimitado com espaços). `0008`: `char_length(name) between 1 and 120 and name ~ '^\S(.*\S)?$'` (sem espaço, tabulação ou quebra de linha nas pontas).
- **M6 — fixtures com nomes que colidiriam com um seed futuro:** prefixo `[teste]`. **M7 —** teste de privilégio também por coluna (`has_any_column_privilege`). **M8 —** casos de escrita negada que faltavam.

**Aceito e registrado:**
- **M4:** `updated_at` só é mantido pelo ORM (`$onUpdate`); um UPDATE por SQL puro não o altera. Se algum dia ele alimentar auditoria ou sincronização, vira trigger.
- **M5:** o admin pode alterar `id`, `service_id`, `insurance_id` ou reviver uma linha (o índice único barra o conflito). Nada em fases futuras deve depender de `service_prices.id` estável: o valor é **copiado** para o atendimento.
- **M9:** o teste do enum inválido (22P02) falha no parse, não na RLS; serve como teste de constraint.

## T3 a T5 — como ficou
- **Camada de dados** (`src/server/catalog/queries.ts` e `mutations.ts`, só por `withUser`): quem não pode ver valores/convênios (profissional) recebe lista vazia **do banco**; o código não repete a regra por papel. Gravações devolvem valor (`ok` | `duplicate` | `not-found` | `denied`), nunca exceção do banco; `setPrice` atualiza o valor existente ou cria (índice único parcial como rede de segurança). `src/server/db/pg-error.ts` extrai o SQLSTATE (também usado pelo harness de testes). Teste de integração `src/server/db/catalog-data.test.ts` pelo caminho real (`app_backend`), fixtures commitados pelo dono e apagados no fim (conferido: 0 resíduos).
- **Server Actions** (`src/server/catalog/actions.ts`): todas começam com `requireRole("admin")`, antes de ler a entrada; Zod; mensagens fixas em pt-BR. Em **erro** devolvem também os valores digitados (`values`), porque o React 19 limpa o formulário depois de cada ação (o e2e pegou: o usuário perdia o que digitou). O `server-actions-guard.test.ts` cobre o arquivo novo (conferido com mutante: sem `requireRole` em uma ação, o teste falha).
- **Telas** (mobile-first): `/servicos` (admin edita; recepção lê com valor; **profissional só nome, especialidade e duração**: nem a consulta de valores é feita para ele), `/convenios` e `/convenios/[id]` (admin edita; recepção lê; profissional negado). Matriz: `servicos` = admin, recepção, profissional; `convenios` = admin, recepção. Gaveta lateral (`Sheet`) com o formulário **dentro**, para reabrir nascer limpo. Sem componente shadcn novo: lista nativa (`NativeSelect`, abre o seletor do sistema no celular) e os `Card`/`Input`/`Button`/`Sheet` já existentes. `not-found.tsx` em pt-BR para as telas internas (o do Next é em inglês). Cada página chama `requirePageAccess("<sua rota>")` (convenção travada por `page-access.test.ts`).
- **e2e** (`e2e/catalog.spec.ts`, 25 casos nos dois projetos): admin cria/edita/desativa pela tela e o banco confirma; erros em pt-BR sem gravar e **sem apagar o formulário**; recepção só lê; profissional não vê valor **nem no HTML entregue** (valores de 7 dígitos como marcador) e é barrado em `/convenios`. Capturas de tela conferidas no desktop e no celular.
- Pequenos extras: `parseBRLToCents` ("1.200,50", "R$ 150", recusa ambiguidade como "1200.50") e `formatCentsForInput` em `src/lib/money.ts`; nomes normalizados em NFC.

## T6 — revisão final da 1B-1 (subagente independente) e resposta
Sem achado crítico: nenhum caminho de leitura de valores pelo profissional nem de gravação fora do admin (conferidos: `requireRole` primeiro em todas as ações, props dos componentes, módulos `server-only` fora do bundle do cliente, ids/UUID validados antes do banco).
**Corrigido:** teste vermelho (`/convenios/[id]` chamava `requirePageAccess("/convenios")`; vale a convenção da rota própria); erro e texto antigos reapareciam ao reabrir a gaveta (formulário agora vive dentro dela); `setPrice` podia atualizar um valor já removido por outro admin (corrida); texto que o Zod deixa passar mas o banco recusa (byte nulo, espaço Unicode na ponta) estourava em vez de virar mensagem; nomes em Unicode decomposto furavam a unicidade (NFC); mensagem em inglês no id inválido; cliques de ativar/desativar/remover não atualizavam a tela quando o banco recusava; rótulo acessível "Remover o valor de X" não continha o texto visível (WCAG 2.5.3); alvos de toque de 24–28 px no celular (agora 40 px); e2e fracos (não conferia que o formulário manteve o texto; marcador de 4 dígitos podia coincidir com ids do HTML).
**Aceito e registrado:** o guarda de Server Actions só confere a presença de `requireRole(`, não o argumento nem a ordem (o teste de unidade da ação cobre os dois), e ignora `export const x = async () =>`; `notFound()` dentro do layout com `Suspense` devolve status 200 com `noindex` (cosmético); `/convenios/[id]` não é revalidada ao mudar um serviço (a página é dinâmica, o efeito é mínimo); `parseBRLToCents("0.100")` lê R$ 100 (consequência da regra do ponto como milhar; documentada).
