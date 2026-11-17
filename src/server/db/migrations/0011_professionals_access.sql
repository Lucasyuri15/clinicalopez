-- Profissionais (1B-2a): grants mínimos e políticas de RLS de professionals e professional_services.
-- As tabelas, as FKs compostas e os índices vêm da 0010 (gerada pelo drizzle-kit).
--
-- Quem lê:   professionals -> admin (todos), reception (não removidos) e o PRÓPRIO profissional
--            (só a linha cujo profile_id é o dele; nunca colegas);
--            professional_services -> admin (todas), reception (profissional E serviço não removidos)
--            e o profissional (só as ligações do próprio cadastro).
-- Quem grava: só admin. professionals: INSERT e UPDATE (sem DELETE: exclusão lógica por deleted_at).
--            professional_services: INSERT e DELETE (tabela de ligação/configuração; sem UPDATE).
-- Quem é admin/reception/professional vem de app.current_app_role() (lê profiles: ativo e não
-- removido), não do JWT. Toda tabela tem a política RESTRICTIVE de aal2 (modelo: 0003).
-- Escrita de não-admin falha SEMPRE com 42501 na própria política (antes de qualquer constraint),
-- então nenhum erro de duplicata/chave estrangeira revela linhas que a pessoa não pode ler.

REVOKE ALL ON TABLE public.professionals, public.professional_services FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.professionals TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE public.professional_services TO authenticated;--> statement-breakpoint

-- professionals
CREATE POLICY professionals_select_admin ON public.professionals
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY professionals_select_reception ON public.professionals
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'reception' AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY professionals_select_self ON public.professionals
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'professional'
		AND deleted_at IS NULL
		AND profile_id = (SELECT auth.uid())
	);--> statement-breakpoint
CREATE POLICY professionals_insert_admin ON public.professionals
	FOR INSERT TO authenticated
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY professionals_update_admin ON public.professionals
	FOR UPDATE TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin')
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY professionals_require_aal2 ON public.professionals
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');--> statement-breakpoint

-- professional_services
CREATE POLICY professional_services_select_admin ON public.professional_services
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY professional_services_select_reception ON public.professional_services
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_services.professional_id AND p.deleted_at IS NULL
		)
		AND EXISTS (
			SELECT 1 FROM public.services AS s
			WHERE s.id = professional_services.service_id AND s.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY professional_services_select_self ON public.professional_services
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'professional'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_services.professional_id
				AND p.deleted_at IS NULL
				AND p.profile_id = (SELECT auth.uid())
		)
	);--> statement-breakpoint
-- O admin não liga serviço a profissional (ou serviço) removido; a FK composta cuida da especialidade.
CREATE POLICY professional_services_insert_admin ON public.professional_services
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) = 'admin'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_services.professional_id AND p.deleted_at IS NULL
		)
		AND EXISTS (
			SELECT 1 FROM public.services AS s
			WHERE s.id = professional_services.service_id AND s.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY professional_services_delete_admin ON public.professional_services
	FOR DELETE TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY professional_services_require_aal2 ON public.professional_services
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');
