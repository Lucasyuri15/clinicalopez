# AGENTS.md — López + Saúde

Sistema interno de agendamentos e gestão para a clínica familiar López + Saúde
(Fisioterapia, Odontologia, Psicologia). Requisitos completos em `docs/PRD.md` — leia antes de mudanças de escopo.

## Stack
**Instalado (Fase 0):** Next.js 16 (TypeScript strict, App Router, Cache Components) · Tailwind 4 · shadcn/ui (Base UI) · Vitest · Playwright · pnpm.
**Planejado (a partir da Fase 1, quando os projetos existirem):** deploy na **Vercel** · **Supabase** (Postgres, Auth com MFA, Storage, RLS) · Drizzle ou Prisma · Zod.

> O Next.js desta versão tem mudanças de API: antes de escrever código de framework, consulte `node_modules/next/dist/docs/` (veja o bloco ao final deste arquivo). Se um comando abaixo ainda não existir, crie-o em vez de inventar alternativa e mantenha esta seção atualizada.

## Comandos
```bash
pnpm install                 # instala dependências
pnpm dev                     # app em http://localhost:3000
pnpm build && pnpm start     # build e execução de produção local

pnpm lint                    # ESLint
pnpm typecheck               # next typegen && tsc --noEmit
pnpm test                    # unitários/componentes (Vitest, jsdom)
pnpm test:e2e                # fluxos completos (Playwright: projetos desktop e mobile; sobe o `pnpm dev`)

# A partir da Fase 1 (ainda NÃO existem):
pnpm db:generate             # gera migração a partir do schema
pnpm db:migrate              # aplica migrações (confirme SEMPRE o ambiente alvo: dev x produção)
pnpm db:seed                 # dados FICTÍCIOS, somente no ambiente de DEV
pnpm backup                  # exporta banco + anexos criptografados (ver PRD, seção 5)
```
**Antes de dizer que terminou:** `pnpm lint && pnpm typecheck && pnpm test` devem passar. Mudanças de fluxo/UI: rode também `pnpm test:e2e` e confira no navegador (desktop e celular).

## Estrutura (alvo)
```
src/app/            rotas e telas (App Router); (app)/ = telas com o shell da clínica
src/components/     layout/ (shell, menu), ui/ (shadcn), componentes reutilizáveis
src/lib/            utilitários puros: money (BRL em centavos), datetime (Brasília), navigation (menu)
src/test/           setup do Vitest
e2e/                testes Playwright (*.spec.ts)
docs/               PRD, specs/ e plans/; docs/brand/ identidade visual

# Previsto a partir da Fase 1:
src/server/         regras de negócio, acesso a dados, autorização
src/server/db/      schema, migrações, seed
src/server/storage/ interface de anexos (driver Supabase Storage / S3 no futuro)
```

## Convenções
- **Idioma:** UI, mensagens e textos em **pt-BR**; código, identificadores e commits em **inglês**.
- **TypeScript strict**; sem `any` (use `unknown` + validação). Validação de entrada com **Zod** em toda fronteira (forms, actions, API).
- **Autorização no servidor** (camada única de acesso a dados em `src/server`) **e** reforçada por **RLS** no Supabase, com as políticas versionadas em migrações SQL. Perfis: `admin`, `reception`, `professional`. Recepção nunca lê prontuário; profissional só os próprios pacientes; admin acessa tudo. Todo acesso a prontuário gera log de auditoria.
- **Auth:** Supabase Auth com MFA obrigatório para admin e profissionais; sem cadastro público (usuários criados pelo admin).
- **Datas:** salvar em UTC; exibir em `America/Sao_Paulo`. **Dinheiro:** inteiro em centavos, formatar em BRL só na exibição.
- **Banco:** toda alteração via migração versionada; nunca editar migração já aplicada. Exclusão de dados clínicos é lógica (soft delete) com auditoria.
- **Agenda:** conflito de horário (profissional e paciente) é checado no servidor e protegido por constraint/transação no banco, não só na UI.
- **Portabilidade (PRD 6.1):** configuração só por variáveis de ambiente (`.env`, mantenha `.env.example` atualizado); anexos pela interface de storage; jobs como rotas HTTP protegidas por segredo (Vercel Cron); evite recursos exclusivos da Vercel quando houver alternativa padrão.
- **Ambientes:** produção (dados reais) e dev/preview (projeto Supabase separado). Dados reais só em produção.
- **UI:** mobile-first e acessível (WCAG AA). Cores e fontes só via tokens do tema (marca: amarelo `#F7CB2C`, medido na logo, + preto `#111111`; texto preto sobre amarelo; token `--brand` em `src/app/globals.css`). Cores de status separadas da cor de marca.
- **Testes:** obrigatórios para regras de conflito de agenda, recorrência, permissões (RBAC) e cálculo financeiro. Teste novo ao corrigir bug.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`…), pequenos e focados.
- Prefira código simples e dependências já presentes; justifique qualquer biblioteca nova.

## Fluxo de trabalho
Adaptado do workflow do projeto [Superpowers](https://github.com/obra/superpowers) (só a metodologia; o plugin não é dependência).

**Classifique antes de agir:**
- **Pequena** (bug localizado, texto/estilo, teste): faça direto, seguindo os passos 5 a 7.
- **Grande:** nova fase/módulo do PRD, schema ou migração, auth/RBAC/RLS, prontuário e anexos, WhatsApp, backup/infra, refactor em muitos arquivos, qualquer decisão que mude o PRD. Use **plan mode** e siga todos os passos, só implementando após aprovação.

**Passos (mudança grande):**
1. **Entender e questionar (brainstorming).** Antes de qualquer código, leia o que já existe (PRD, código, docs) e não pergunte o que já está respondido. Devolva com suas palavras o que entendeu e o porquê. Faça **uma pergunta por vez**, a de maior impacto. Se algo não for óbvio, apresente 2–3 abordagens com prós e contras e uma recomendação, e espere a escolha.
2. **Design aprovado.** Registre a decisão em `docs/specs/AAAA-MM-DD-<tema>.md` (curto se for pequeno) e obtenha aprovação antes de planejar. Se mudar o PRD, atualize `docs/PRD.md` na mesma entrega.
3. **Ambiente isolado.** Trabalhe numa branch própria (git worktree, se possível). Rode a suíte antes de começar para ter uma base verde. *(Pré-requisito: inicializar o repositório git — hoje o projeto ainda não é um.)*
4. **Plano em tarefas pequenas.** Salve em `docs/plans/AAAA-MM-DD-<tema>.md`. Cada tarefa: 2–5 minutos, caminhos exatos de arquivos, interfaces/assinaturas, o teste que a prova e o comando de verificação. Princípios: **YAGNI** e **DRY**. Plano com vários subsistemas independentes vira vários planos.
5. **Executar tarefa a tarefa com TDD.** Ciclo **RED → GREEN → REFACTOR**: escreva o teste, **veja-o falhar pelo motivo certo**, escreva o mínimo para passar, veja passar, refatore. *Sem código de produção sem um teste falhando antes*; se escreveu código antes do teste, descarte e refaça. Exceções (confirme com o usuário): protótipo descartável, código gerado, configuração e ajuste puramente visual.
6. **Revisão a cada tarefa.** Peça revisão a um subagente com contexto enxuto (descrição, requisitos, diff), não com todo o histórico da sessão. Corrija o que for **crítico** e **importante** antes de seguir; registre os menores. Se o revisor estiver errado, responda com argumento técnico e teste. Tarefa grande ou sensível (RBAC, financeiro, migração): revisão obrigatória; revisão final da branch antes de integrar.
7. **Verificação antes de afirmar sucesso.** *Nenhuma afirmação de conclusão sem evidência recente.* Rode os comandos completos nesta mesma resposta (`pnpm lint`, `typecheck`, `test`, e `test:e2e` se mexeu em fluxo/UI), leia a saída e o código de saída, e só então declare. Proibido "deve funcionar", "provavelmente" ou comemorar antes de verificar. Se delegou a um subagente, confira você mesmo o diff.
8. **Finalizar a branch.** Com a suíte verde, apresente as opções ao usuário: (1) integrar localmente na branch base, (2) abrir Pull Request, (3) manter a branch. Confirme a branch base antes de mesclar. Descartar trabalho só se o usuário pedir explicitamente.

**Depurando:** investigue a **causa raiz** antes de corrigir (reproduza, leia o erro completo, rastreie a origem, compare com código que funciona, teste uma hipótese por vez). Nada de "chutar" correções; todo bug corrigido ganha um teste de regressão que falhou antes da correção.

**Regras gerais**
- Commit/push somente quando o usuário pedir. Ao aprovar um plano, o usuário pode autorizar commits por tarefa (Conventional Commits).
- Nunca confie cegamente em relatório de subagente; verifique no diff e rodando os comandos.
- Não misture mudanças não relacionadas na mesma entrega.

## Proibições
- **Nunca** usar dados reais de pacientes em código, testes, seeds, fixtures, prints ou logs. Só dados fictícios.
- **Nunca** commitar segredos (`.env`, tokens do WhatsApp/Meta, chaves de backup) nem logar dados de saúde ou PII (CPF, telefone, prontuário).
- **Nunca** contornar ou duplicar a checagem de permissões, nem criar rota/endpoint sem autorização.
- **Nunca** criar rota pública, desativar RLS, usar a chave `service_role` do Supabase no cliente/browser ou prefixar segredos com `NEXT_PUBLIC_`.
- **Nunca** apontar `pnpm dev`, testes, seeds ou migrações experimentais para o banco de **produção**.
- **Nunca** rodar comandos destrutivos (`drop`, `truncate`, `rm -rf`, reset de banco) sem confirmação explícita do usuário e backup prévio.
- **Nunca** editar migrações já aplicadas, nem apagar registros clínicos de forma física.
- **Nunca** fixar URLs/caminhos/regiões no código nem criar dependência de recursos exclusivos da Vercel sem necessidade.
- **Nunca** deixar o site ser indexado por buscadores (manter `noindex`).
- **Nunca** usar texto amarelo sobre fundo branco (contraste insuficiente).
- **Nunca** adicionar telemetria/analytics ou enviar dados a serviços externos sem aprovação.
- Não implementar itens fora do escopo do MVP (autoagendamento, TISS/nota fiscal, teleconsulta, app nativo, odontograma) sem alteração prévia do PRD.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
