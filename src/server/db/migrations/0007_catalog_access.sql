-- Catálogo (1B-1): grants mínimos e políticas de RLS de services, insurances e service_prices.
-- As tabelas e os índices vêm da 0006 (gerada pelo drizzle-kit).
--
-- Quem lê:   services -> admin, reception, professional;
--            insurances e service_prices -> admin e reception. O profissional NUNCA lê valores
--            nem convênios (RLS é por LINHA: por isso o valor não é coluna de services).
-- Quem grava: só admin. Sem DELETE para ninguém (exclusão lógica por deleted_at).
-- Não-admin só enxerga linhas NÃO removidas; admin enxerga todas.
-- O papel vem de app.current_app_role() (lê profiles: ativo e não removido), não do JWT.
-- Toda tabela tem a política RESTRICTIVE de aal2 (modelo: 0003_require_aal2.sql).

REVOKE ALL ON TABLE public.services, public.insurances, public.service_prices
	FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.services, public.insurances, public.service_prices
	TO authenticated;--> statement-breakpoint

-- services
CREATE POLICY services_select_admin ON public.services
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY services_select_staff ON public.services
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) IN ('reception', 'professional') AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY services_insert_admin ON public.services
	FOR INSERT TO authenticated
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY services_update_admin ON public.services
	FOR UPDATE TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin')
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY services_require_aal2 ON public.services
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');--> statement-breakpoint

-- insurances
CREATE POLICY insurances_select_admin ON public.insurances
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY insurances_select_reception ON public.insurances
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'reception' AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY insurances_insert_admin ON public.insurances
	FOR INSERT TO authenticated
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY insurances_update_admin ON public.insurances
	FOR UPDATE TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin')
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY insurances_require_aal2 ON public.insurances
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');--> statement-breakpoint

-- service_prices
CREATE POLICY service_prices_select_admin ON public.service_prices
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY service_prices_select_reception ON public.service_prices
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'reception' AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY service_prices_insert_admin ON public.service_prices
	FOR INSERT TO authenticated
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY service_prices_update_admin ON public.service_prices
	FOR UPDATE TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin')
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY service_prices_require_aal2 ON public.service_prices
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');
