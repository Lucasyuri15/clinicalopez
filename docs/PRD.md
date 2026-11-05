# PRD — Sistema de Agendamentos López + Saúde

**Versão:** 0.4 (rascunho) · **Data:** 2026-11-04 · **Status:** Em refinamento — hospedagem definida: **Vercel + Supabase**; Fase 0 (fundação) implementada na branch `feat/fase-0-fundacao`

---

## 1. Visão geral

Dashboard e gerenciador de agendamentos de uso **interno** para a clínica **López + Saúde**, que atende em três áreas: **Fisioterapia, Odontologia e Psicologia**. O sistema centraliza agenda, cadastros, prontuário (evolução clínica), financeiro básico e indicadores da operação.

### 1.1 Objetivos
- Substituir controles manuais (papel/planilha/WhatsApp) por uma agenda única e confiável.
- Reduzir faltas e conflitos de horário.
- Dar à gestão visibilidade operacional e financeira em um dashboard.
- Registrar a evolução clínica de forma segura e em conformidade com a LGPD.

### 1.2 Fora do escopo (MVP)
- Autoagendamento do paciente (portal/link público).
- Emissão de nota fiscal e faturamento TISS/guias de convênio.
- Telemedicina/teleconsulta.
- App mobile nativo (apenas web responsivo).
- Odontograma e templates de prontuário por especialidade (ficam para versões futuras).
- Repasse a profissionais e pacotes pré-pagos com saldo financeiro (apenas pacotes de sessões na agenda, ver 4.2).
- Múltiplas unidades.

---

## 2. Contexto e porte

| Item | Definição |
|---|---|
| Natureza | Clínica **familiar**, uso restrito e interno |
| Unidades | 1 |
| Profissionais | **3** atualmente (pode crescer no futuro) |
| Especialidades | Fisioterapia, Odontologia, Psicologia |
| Hospedagem | **Vercel** (aplicação) + **Supabase** (banco, autenticação e anexos), ambos em região do Brasil. Sem servidor local. Código mantido **portável** para reduzir dependência do provedor (seção 6.1) |
| Acesso | Desktop e celular via navegador, de qualquer lugar, por HTTPS, com login individual e 2FA (seção 5) |
| Logins | 3 profissionais + 1 recepcionista + admin, cada um com credencial própria |
| Prazo | Sem prazo rígido; entrega em fases |
| Plataforma | Web responsivo (desktop-first, utilizável em tablet/celular) |

---

## 3. Perfis de usuário e permissões (RBAC)

| Perfil | Descrição | Permissões principais |
|---|---|---|
| **Administrador/gestor** | Dono ou gerente | **Acesso a tudo**, inclusive prontuários (decisão atual): dashboard completo (incl. financeiro), cadastros, usuários, configurações, relatórios. Acessos a prontuário continuam registrados em log. |
| **Recepção/secretaria** | Opera a agenda | Cria/remarca/cancela agendamentos, gerencia pacientes e lista de espera, registra status e pagamento. **Não acessa prontuário clínico.** |
| **Profissional de saúde** | Fisioterapeuta, dentista, psicólogo | Vê a própria agenda; acessa e escreve prontuário **apenas dos seus pacientes**; atualiza status dos seus atendimentos. |

> Regra: a agenda é por profissional. Prontuário é restrito ao profissional responsável (e admin conforme política definida na seção 8).

---

## 4. Requisitos funcionais

### 4.1 Cadastros
- **Pacientes:** nome, CPF, data de nascimento, contato (telefone/WhatsApp, e-mail), endereço, convênio (se houver), observações administrativas, consentimento LGPD.
- **Profissionais:** nome, especialidade, registro profissional (CREFITO / CRO / CRP), contato, serviços que realiza, **grade de horários de atendimento** (dias/horários, intervalos, folgas e bloqueios).
- **Serviços/procedimentos:** nome, especialidade, duração, valor particular, valores por convênio.
- **Convênios:** nome do plano e tabela de valores por serviço.
- **Usuários:** vinculados a um perfil (RBAC); profissionais vinculados ao cadastro de profissional.

### 4.2 Agendamento
- **Agenda por profissional**, com visões dia/semana (e mês) e filtro por especialidade/profissional.
- **Criar, remarcar e cancelar** agendamentos, com **detecção de conflito** de horário (profissional e paciente) e respeito à grade/bloqueios do profissional.
- **Status da consulta:** `Agendada → Confirmada → Realizada`, além de `Falta` e `Cancelada` (com motivo).
- **Recorrência/pacotes de sessões:** criar séries (ex.: fisioterapia 2x/semana por 10 sessões; psicoterapia semanal), com edição de uma ocorrência ou da série inteira e acompanhamento de sessões realizadas/restantes.
- **Lista de espera:** registrar pacientes aguardando vaga (profissional/especialidade, preferência de dias/horários) e sugerir/encaixar quando um horário vagar.

### 4.3 Lembretes e confirmação (WhatsApp)
- **Objetivo:** envio **automático** de lembrete e confirmação de consulta via WhatsApp (ex.: 24h antes), com atualização do status ao receber a resposta do paciente.
- **Fallback no MVP:** botão que abre conversa do WhatsApp com mensagem pré-preenchida (envio manual), usado até a integração automática estar pronta.

**Requisitos para o envio automático — Opção A: API oficial (WhatsApp Cloud API, Meta)**
- Conta **Meta Business** (Business Manager), idealmente com a empresa verificada (CNPJ).
- **Número de telefone dedicado** à clínica, que não pode estar ativo no app WhatsApp comum (ou migra para a API e deixa de usar o app nesse número).
- App criado no Meta for Developers com o produto WhatsApp, **token de acesso permanente** (usuário de sistema) e o ID do número.
- **Templates de mensagem aprovados** pela Meta para mensagens iniciadas pela clínica (lembrete/confirmação), pois fora da janela de 24h de conversa só templates são permitidos.
- Forma de pagamento cadastrada (mensagens por template são cobradas por conversa/mensagem).
- **Webhook HTTPS público** para receber as respostas do paciente (confirmar/cancelar): atendido por uma rota da própria aplicação na Vercel, com **validação da assinatura** da Meta e verificação do token do webhook.
- Consentimento do paciente para receber mensagens (registrado no cadastro).

**Requisitos — Opção B: API não oficial (ex.: Evolution API / Baileys)**
- Conecta por **QR Code** ao número já usado pela clínica; sem aprovação de templates e sem custo por mensagem.
- Exige um **processo sempre ligado** (conexão persistente), o que **não roda em funções serverless da Vercel**: seria necessário um servidor separado (VPS/PC), contrariando a decisão de não manter servidor.
- **Risco:** viola os termos do WhatsApp e o número pode ser **banido**; menos estável.

**Recomendação:** começar pelo fallback manual (Fase 6a) e evoluir para a **Opção A (API oficial)**, que se encaixa na Vercel. A Opção B fica descartada no MVP.

### 4.4 Prontuário / evolução clínica
- Registro de **evolução em texto por consulta**, vinculado ao agendamento e ao paciente.
- **Anexos** (exames, imagens, documentos) por paciente/consulta.
- Histórico cronológico do paciente.
- Edição com **trilha de auditoria** (quem, quando, o quê) e **log de acesso**; registros finalizados não são apagados silenciosamente.
- Visível somente ao profissional responsável (e conforme seção 8).

### 4.5 Financeiro básico
- Atendimento classificado como **Particular** ou **Convênio**.
- Valor sugerido automaticamente pelo serviço/convênio, editável pela recepção/admin.
- Controle de status de pagamento (pendente/pago) para particulares e registro de valor a receber de convênios.
- Sem emissão fiscal/TISS no MVP.

### 4.6 Dashboard
Visão para o administrador (recortes menores para recepção/profissional conforme permissão):

| Bloco | Indicadores |
|---|---|
| **Agenda do dia/semana** | Calendário por profissional e especialidade, próximos atendimentos, horários vagos. |
| **Operacionais** | Taxa de faltas e cancelamentos, taxa de ocupação da agenda, atendimentos por especialidade/profissional. |
| **Pacientes** | Novos pacientes, retornos, abandono de tratamento/retenção. |
| **Financeiros** | Faturamento por especialidade e profissional, particular vs convênio, valores a receber. |

Filtros por período, especialidade e profissional.

---

## 5. Requisitos não funcionais

- **Segurança e privacidade (LGPD):** dados de saúde são **dados pessoais sensíveis**. Exige base legal e consentimento registrados, controle de acesso por perfil, criptografia em trânsito e em repouso, logs de auditoria, política de retenção e fluxo para atender direitos do titular.
- **Sigilo profissional:** prontuário isolado por profissional, com autorização aplicada no servidor (camada de acesso a dados única) **e** reforçada por **Row Level Security** no banco (defesa em profundidade).
- **Desempenho:** telas principais (agenda/dashboard) carregam em < 2s para o porte previsto.
- **Sistema exposto à internet:** por estar público, exige defesas reforçadas:
  - **2FA (TOTP) obrigatório para todos os perfis** (admin, recepção e profissionais; decisão da Fase 1A-2); senhas fortes e sessões com expiração.
  - **Limite de tentativas de login** (rate limiting) e proteção contra enumeração de usuários.
  - **Bloqueio de indexação** (`noindex`, `robots.txt`) e cabeçalhos de segurança (HSTS, CSP, etc.).
  - Todas as rotas e ações autenticadas e autorizadas; **nenhum cadastro público** (usuários criados pelo admin).
  - Segredos apenas em variáveis de ambiente da Vercel/Supabase; **sem PII ou dados de saúde em logs**.
  - **Ambientes separados:** produção com dados reais; desenvolvimento/preview sem dados reais (projeto Supabase distinto).
- **Residência dos dados (LGPD):** banco e storage em região do Brasil (Supabase `sa-east-1`) e funções da Vercel em `gru1` (São Paulo). Verificar contratos/DPA dos provedores e registrar na política de privacidade.
- **Backup e recuperação:** usar os backups do plano do Supabase (confirmar frequência e retenção do plano contratado) e manter **exportação periódica criptografada** (dump do banco + anexos) em local separado do provedor. Teste de restauração periódico.
- **Disponibilidade:** depende de Vercel/Supabase; não há manutenção de hardware ou servidor pela clínica.
- **Custos:** a Vercel exige plano pago (Pro) para uso comercial e o Supabase pago traz backups diários; **levantar valores atuais antes da contratação**.
- **Responsividade:** uso em desktop, tablet e celular.
- **Acessibilidade:** boas práticas WCAG AA (contraste, navegação por teclado).
- **Idioma e fuso:** pt-BR; fuso `America/Sao_Paulo`; datas e moeda em formato brasileiro.

---

## 6. Stack técnica

| Camada | Escolha |
|---|---|
| Front-end/Back-end | **Next.js** (TypeScript, App Router), web responsivo mobile-first |
| Hospedagem da app | **Vercel** (plano Pro), funções na região `gru1` (São Paulo) |
| Banco | **Supabase Postgres**, região `sa-east-1`, com *connection pooling* para ambiente serverless |
| ORM/migrações | **Drizzle** (decidido na Fase 1A-1); migrações versionadas (incluindo as políticas de RLS em SQL). O app conecta com o papel `app_backend` (sem BYPASSRLS) e cada requisição assume o papel `authenticated` com o usuário logado, para a RLS valer de verdade; migrações usam o papel `postgres`. Ver `docs/specs/2026-11-05-fase-1a1-banco-rls.md` |
| Autenticação | **Supabase Auth** com **MFA (TOTP) obrigatório para todos**; sem cadastro público. Na Fase 1A-2 os usuários são criados **pelo painel do Supabase** (sem chave *secret* no app) e o papel é vinculado por comando local (`pnpm users:link`); a tela de usuários no app fica para a 1B. Recuperação de 2FA por comando local do dono (`pnpm users:reset-mfa`): os *recovery codes* do Supabase são experimentais e não são usados. Sem "esqueci minha senha" por e-mail até haver SMTP próprio (reset pelo painel) |
| Autorização | RBAC (admin, recepção, profissional) no servidor + **RLS** no banco. Acesso por tela (1A-2): **admin** = tudo; **recepção** = Dashboard, Agenda, Pacientes, Financeiro; **profissional** = Dashboard, Agenda, Pacientes (recortes próprios virão com os cadastros); Profissionais, Serviços e Configurações = só admin |
| Anexos | **Supabase Storage**, buckets privados e URLs assinadas de curta duração |
| Tarefas agendadas | **Vercel Cron** chamando rotas protegidas por segredo (lembretes WhatsApp, exportação de backup); frequência depende do plano |
| WhatsApp | API oficial (Cloud API); webhook como rota da aplicação com validação de assinatura |
| Ambientes | Produção (dados reais) e desenvolvimento/preview (projeto Supabase separado, só dados fictícios) |

> Mudança em relação ao rascunho 0.2: a execução local (PC servidor, Docker, Tailscale) foi abandonada em favor de **Vercel + Supabase**, o que simplifica acesso remoto e webhook do WhatsApp. Em troca, o sistema passa a ficar exposto à internet, com as defesas da seção 5.

### 6.1 Princípios de portabilidade (reduzir dependência de provedor)
1. Configuração só por variáveis de ambiente; nenhum endereço/caminho fixo no código; manter `.env.example`.
2. Banco acessado via ORM e migrações; políticas de RLS versionadas em SQL (permite recriar o banco em outro Postgres).
3. Anexos atrás de uma interface de storage, com driver Supabase hoje e outro (S3 compatível) no futuro.
4. Jobs agendados expostos como rotas HTTP, chamáveis por qualquer agendador (Vercel Cron ou outro).
5. Evitar recursos exclusivos da Vercel (ex.: Edge-only) quando houver alternativa padrão.
6. Exportação periódica do banco e dos anexos em formato padrão (SQL/arquivos), garantindo saída do provedor.

Detalhes (UI kit, biblioteca de calendário, testes) serão definidos na fase de arquitetura.

---

## 7. Identidade visual

- Logo recebida: texto **"LOPEZ + SAÚDE"** em preto sobre fundo **amarelo vibrante**, com tipografia arredondada, pesada e amigável (sinal "+" como cruz de saúde).
- **Paleta base:** amarelo **`#F7CB2C`** (medido nos pixels de `logo.png`) e preto `#111111`; neutros claros para fundos de tabelas/formulários. Contraste preto sobre amarelo ≈ 12:1 (WCAG AA/AAA).
- **Direção:** amarelo como cor de marca (barra lateral, botões primários, destaques) com **texto preto sobre amarelo** — nunca texto amarelo sobre branco (contraste insuficiente). Cores de status (confirmada/falta/cancelada) separadas da cor de marca.
- **Tipografia:** títulos em fonte arredondada e pesada, semelhante à logo (sugestão: Fredoka ou Baloo 2); corpo em fonte sem serifa legível (sugestão: Inter).
- **Pendente:** arquivo original da logo (idealmente SVG, ou PNG de alta resolução com fundo transparente) em `/docs/brand/`; hoje usamos o PNG 640×640 enviado. Tokens de cor/tipografia centralizados em `src/app/globals.css`.

---

## 8. Dados sensíveis — decisões e premissas

- O perfil **Recepção não acessa o prontuário**.
- O **Administrador tem acesso a tudo**, inclusive prontuário (decisão atual, pode ser revista).
- Todo acesso/alteração em prontuário gera log.
- Mesmo sendo clínica familiar e de uso restrito, a LGPD se aplica a dados de saúde. Com o sistema hospedado na internet: 2FA, RLS, backups, região Brasil e logs sem dados pessoais (seção 5).

---

## 9. Fases sugeridas

| Fase | Entrega |
|---|---|
| **0 — Fundação** ✅ | Projeto Next.js 16 (TS strict) com pnpm, Tailwind + shadcn/ui, identidade visual (amarelo `#F7CB2C`, Fredoka/Inter), layout responsivo (sidebar no desktop, gaveta no celular) com telas provisórias, utilitários de moeda (BRL em centavos) e data (Brasília), `noindex` e cabeçalhos de segurança, testes (Vitest + Playwright). **Sem login e sem banco**, por ainda não haver projeto Supabase. |
| **1 — Cadastros** | **Antes:** contas/projetos Vercel + Supabase (produção e dev), ORM (Drizzle ou Prisma) e migrações, Supabase Auth com 2FA, RBAC + RLS, CSP completa, limite de tentativas de login, exportação de backup. **Depois:** pacientes, profissionais (grade de horários), serviços, convênios, usuários. |
| **2 — Agenda** | Agendamento com conflito, status, remarcação/cancelamento, visões dia/semana. |
| **3 — Recorrência e espera** | Pacotes/séries de sessões e lista de espera. |
| **4 — Prontuário** | Evolução em texto, anexos, auditoria. |
| **5 — Financeiro e Dashboard** | Cobrança básica e indicadores. |
| **6 — Lembretes** | Fallback manual do WhatsApp e, depois, integração automática. |

---

## 10. Métricas de sucesso

- Redução da taxa de faltas após uso de confirmação/lembretes.
- Zero conflitos de agenda (double booking).
- Aumento da taxa de ocupação da agenda.
- Tempo para agendar/remarcar < 1 minuto pela recepção.
- 100% dos atendimentos realizados com status registrado.

---

## 11. Questões em aberto

**Resolvidas:** admin com acesso total (seção 3/8); logo recebida (seção 7); hospedagem na **Vercel** (decidido pelo cliente); servidor local, Docker e Tailscale descartados.

**Premissas adotadas (recomendações, ainda não confirmadas explicitamente):** Supabase como banco/Auth/Storage; plano Pro da Vercel; WhatsApp pela API oficial da Meta.

**Adiadas (sem dados no momento — definir depois):** duração padrão e regras de horário por serviço, convênios e forma de cobrança, política de retenção de prontuário, migração de dados existentes, controle financeiro de pacotes.

**Em aberto:**
1. **Custos e planos:** confirmar planos e valores atuais de Vercel (Pro) e Supabase (com backups diários); quem é o titular das contas.
2. **WhatsApp:** há CNPJ e número dedicado para a API oficial da Meta? Definir em qual fase ativar.
3. **Domínio:** domínio próprio (ex.: `app.lopezmaissaude.com.br`) e quem administra o DNS.
4. **Backup externo:** onde guardar a exportação criptografada periódica e quem verifica os alertas.
5. **2FA:** *resolvida na 1A-2* — obrigatório para todos, app autenticador (TOTP); recuperação por comando local do dono. Resta orientar cada usuário a instalar um app autenticador.
6. **Logo original** (SVG ou PNG de alta resolução). O hex do amarelo já foi medido (`#F7CB2C`).
