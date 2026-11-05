# Spec — Fase 1A-1: banco, Drizzle e RLS

**Data:** 2026-11-05 · **Status:** aprovado pelo usuário (plan mode) · **Plano:** `docs/plans/2026-11-05-fase-1a1-banco-rls.md`

## Contexto
A Fase 1A (acesso e dados) foi dividida em três entregas: **1A-1** (este spec: banco, ORM, RLS), **1A-2** (login, 2FA TOTP, RBAC, proteção das telas) e **1A-3** (CSP, limite de tentativas, variáveis na Vercel, decisão sobre a Data API).

## Decisão principal
O servidor acessa o Postgres do Supabase **diretamente com Drizzle**, mas **sob RLS de verdade**. O PRD (seções 5 e 6) pede RLS como segunda camada de defesa; se o servidor conectasse como dono das tabelas, a RLS seria ignorada e só o código protegeria os dados.

Alternativas descartadas:
- *supabase-js (PostgREST)*: deixa a Data API ligada, prende o código ao Supabase (contra PRD 6.1) e complica transações e a trava anti-conflito de agenda.
- *Drizzle como dono, RLS só "negar tudo"*: a RLS não protegeria contra bug no código.

## Modelo de acesso
| Papel | Uso | Conexão |
|---|---|---|
| `postgres` | Migrações (dono das tabelas) | `DIRECT_URL` (direta, porta 5432) |
| `app_backend` | App em execução. Papel de login **sem BYPASSRLS**, não dono, membro de `authenticated` | `DATABASE_URL` (pooler, porta 6543) |

- Sem contexto de usuário, `app_backend` não tem política em nenhuma tabela: **tudo é negado**.
- `withUser({ userId }, fn)` (único ponto de acesso do código de negócio): abre transação, `set local role authenticated`, `set_config('request.jwt.claims', {"sub": userId}, true)` e executa `fn(tx)`.
- O perfil do usuário (`admin | reception | professional`) vem do banco: função `security definer` `app.current_app_role()` lê `profiles.role` de `auth.uid()`. Não depende de claim no JWT.
- A senha de `app_backend` **nunca** entra em migração: o usuário a define no SQL Editor e guarda só no `.env.local` / variáveis da Vercel.
- `db:migrate` recusa rodar se `DIRECT_URL` não apontar para o projeto dev permitido (protege a produção).

## Schema mínimo (YAGNI)
`profiles`: `id uuid` (= `auth.users.id`), `full_name`, `role` (`user_role`), `active`, `created_at`, `updated_at`, `deleted_at`.
Políticas: cada usuário lê o próprio perfil; `admin` lê, cria e altera todos; recepção e profissional não alteram perfis; sem `DELETE` físico.
Pacientes, auditoria etc. entram em planos posteriores.

## Testes
Sem Docker. Testes de integração rodam contra o Supabase **dev**, dentro de transação com `ROLLBACK`, apenas com dados fictícios, e são **pulados** quando `DATABASE_URL` não existe.

## Riscos e plano B
- Papéis customizados podem falhar de autenticar no pooler compartilhado do Supabase. **Spike antes de tudo.** Plano B: app conecta como `postgres` e a transação faz `set local role authenticated`; compensado por regra ESLint (proibir import do `db` cru fora de `src/server/db/`) e teste que falha se `withUser` não trocar de papel.
- Free tier pausa projetos inativos: pode ser preciso restaurar antes dos testes.

## Resultado do spike
Executado em 2026-11-05 contra o projeto dev (Postgres 17.11, pooler `aws-1-sa-east-1`):
- **Rede:** a conexão direta (`db.<ref>.supabase.co`) falha com `ENOTFOUND` (só IPv6 no plano Free; a rede de desenvolvimento não tem IPv6). **Decisão:** `DIRECT_URL` usa a **Session pooler** (mesmo host do pooler, porta 5432, usuário `postgres.<ref>`), que serve para migrações. `DATABASE_URL` usa a Transaction pooler (porta 6543).
- **(b) Troca de papel — OK:** via Transaction pooler, `set local role authenticated` + `set_config('request.jwt.claims', …, true)` funcionam; dentro da transação `current_user = authenticated` e `auth.uid()` devolve o ID informado; depois dela o papel volta ao da conexão (não vaza entre requisições).
- **(a) Login como `app_backend` — OK:** o papel foi criado à mão no dev (`login`, `nosuperuser`, `nobypassrls`, membro de `authenticated`, senha aleatória gerada localmente e gravada só no `.env.local`). O login pelo pooler (`app_backend.<ref>`, porta 6543) funciona; a partir dele, `set local role authenticated` e `auth.uid()` funcionam e o papel volta a `app_backend` depois da transação; `auth.users` é negado (`42501`). **O plano B não é necessário.**
- **Consequência para a migração (tarefa 3):** a criação de `app_backend` deve ser idempotente (não falhar se o papel já existir, nunca definir senha). Em produção, a senha será gerada e gravada do mesmo jeito, só nas variáveis da Vercel.
