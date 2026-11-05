-- Controle de acesso: papel de login do app, função de perfil, grants mínimos e políticas de RLS.
-- A senha de app_backend NUNCA entra em migração: é definida fora do Git (ver docs/specs).

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
		CREATE ROLE app_backend LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
	END IF;
END
$$;--> statement-breakpoint
-- Sem herança: app_backend não tem nenhum privilégio próprio. Só ganha acesso a dados
-- depois de `SET LOCAL ROLE authenticated` (ver withUser).
ALTER ROLE app_backend NOINHERIT;--> statement-breakpoint
GRANT authenticated TO app_backend WITH INHERIT FALSE, SET TRUE;--> statement-breakpoint

CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO authenticated;--> statement-breakpoint

-- Papel (RBAC) do usuário logado, lido do banco (não do JWT). SECURITY DEFINER para
-- consultar profiles sem recursão de RLS.
CREATE OR REPLACE FUNCTION app.current_app_role()
RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
	SELECT p.role
	FROM public.profiles AS p
	WHERE p.id = (SELECT auth.uid())
		AND p.active
		AND p.deleted_at IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.current_app_role() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_app_role() TO authenticated;--> statement-breakpoint

-- Grants mínimos: nada para anon; authenticated sem DELETE (exclusão é lógica).
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;--> statement-breakpoint

CREATE POLICY profiles_select_self ON public.profiles
	FOR SELECT TO authenticated
	USING (id = (SELECT auth.uid()) AND active AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY profiles_select_admin ON public.profiles
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY profiles_insert_admin ON public.profiles
	FOR INSERT TO authenticated
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY profiles_update_admin ON public.profiles
	FOR UPDATE TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin')
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');
