-- Endurecimento do controle de acesso (achados da revisão da Fase 1A-1).
-- Não edita a 0001 (já aplicada): reafirma e complementa.

-- A 0001 só cria app_backend se ele não existir. Se o papel já existia (criado à mão),
-- os atributos não eram reafirmados. O `postgres` do Supabase não é superuser e não
-- pode alterar SUPERUSER/BYPASSRLS/REPLICATION, então a migração VERIFICA e ABORTA
-- (em vez de passar em silêncio) se o papel tiver algum atributo perigoso.
DO $$
DECLARE
	bad text;
BEGIN
	SELECT concat_ws(', ',
		CASE WHEN rolsuper THEN 'SUPERUSER' END,
		CASE WHEN rolbypassrls THEN 'BYPASSRLS' END,
		CASE WHEN rolreplication THEN 'REPLICATION' END)
	INTO bad
	FROM pg_roles WHERE rolname = 'app_backend';

	IF bad IS NULL THEN
		RAISE EXCEPTION 'O papel app_backend não existe (a migração 0001 deveria tê-lo criado).';
	ELSIF bad <> '' THEN
		RAISE EXCEPTION 'app_backend tem atributos proibidos: %. Recrie o papel sem eles (ver docs/specs).', bad;
	END IF;
END
$$;--> statement-breakpoint
ALTER ROLE app_backend LOGIN NOCREATEDB NOCREATEROLE NOINHERIT;--> statement-breakpoint
GRANT authenticated TO app_backend WITH INHERIT FALSE, SET TRUE;--> statement-breakpoint

-- Limites de tempo do app (statement_timeout etc. do Supabase valem para os papéis
-- anon/authenticated, mas não se aplicam via SET ROLE). Ajuste aqui se uma consulta
-- legítima precisar de mais tempo.
ALTER ROLE app_backend SET statement_timeout = '15s';--> statement-breakpoint
ALTER ROLE app_backend SET lock_timeout = '5s';--> statement-breakpoint
ALTER ROLE app_backend SET idle_in_transaction_session_timeout = '15s';--> statement-breakpoint

-- A função de papel nunca deve ser executável por anon (nem por PUBLIC).
REVOKE ALL ON FUNCTION app.current_app_role() FROM PUBLIC, anon;--> statement-breakpoint

-- Privilégios padrão: no Supabase, tabelas novas criadas por `postgres` em `public`
-- nascem com TRUNCATE/REFERENCES/TRIGGER/MAINTAIN para anon e authenticated
-- (TRUNCATE ignora a RLS). Tabelas futuras passam a nascer SEM nenhum grant para eles;
-- cada migração concede o mínimo necessário a `authenticated` de forma explícita.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
