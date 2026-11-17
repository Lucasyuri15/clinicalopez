-- Grade de horários (1B-2b): exclusão de sobreposição, grants mínimos e políticas de RLS de
-- professional_work_hours e professional_time_off. As tabelas e os índices vêm da 0014.
--
-- Quem lê:   admin (todas); reception (profissional NÃO removido); o PRÓPRIO profissional (só as
--            linhas do cadastro cujo profile_id é o dele; nunca as de colegas).
-- Quem grava: só admin. INSERT (exige profissional não removido) e DELETE; sem UPDATE: editar a
--            semana é apagar e recriar as faixas numa transação (configuração, não registro clínico).
-- Quem é admin/reception/professional vem de app.current_app_role() (lê profiles: ativo e não
-- removido), não do JWT. Toda tabela tem a política RESTRICTIVE de aal2 (modelo: 0003).
-- Escrita de não-admin falha SEMPRE com 42501 na própria política (antes de qualquer constraint),
-- então nenhum erro de sobreposição/limite revela linhas que a pessoa não pode ler.

-- Sem faixas sobrepostas do mesmo profissional no mesmo dia. Faixas meio-abertas [início, fim):
-- 08:00-12:00 e 12:00-14:00 encostam e NÃO conflitam. btree_gist permite combinar igualdade
-- (profissional, dia) com sobreposição de intervalo num mesmo índice GiST.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;--> statement-breakpoint
ALTER TABLE public.professional_work_hours
	ADD CONSTRAINT professional_work_hours_no_overlap
	EXCLUDE USING gist (
		professional_id WITH =,
		weekday WITH =,
		int4range(start_minute::integer, end_minute::integer) WITH &&
	);--> statement-breakpoint

REVOKE ALL ON TABLE public.professional_work_hours, public.professional_time_off FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE public.professional_work_hours, public.professional_time_off TO authenticated;--> statement-breakpoint

-- professional_work_hours
CREATE POLICY professional_work_hours_select_admin ON public.professional_work_hours
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY professional_work_hours_select_reception ON public.professional_work_hours
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_work_hours.professional_id AND p.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY professional_work_hours_select_self ON public.professional_work_hours
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'professional'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_work_hours.professional_id
				AND p.deleted_at IS NULL
				AND p.profile_id = (SELECT auth.uid())
		)
	);--> statement-breakpoint
CREATE POLICY professional_work_hours_insert_admin ON public.professional_work_hours
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) = 'admin'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_work_hours.professional_id AND p.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY professional_work_hours_delete_admin ON public.professional_work_hours
	FOR DELETE TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY professional_work_hours_require_aal2 ON public.professional_work_hours
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');--> statement-breakpoint

-- professional_time_off
CREATE POLICY professional_time_off_select_admin ON public.professional_time_off
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY professional_time_off_select_reception ON public.professional_time_off
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_time_off.professional_id AND p.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY professional_time_off_select_self ON public.professional_time_off
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'professional'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_time_off.professional_id
				AND p.deleted_at IS NULL
				AND p.profile_id = (SELECT auth.uid())
		)
	);--> statement-breakpoint
CREATE POLICY professional_time_off_insert_admin ON public.professional_time_off
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) = 'admin'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_time_off.professional_id AND p.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY professional_time_off_delete_admin ON public.professional_time_off
	FOR DELETE TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY professional_time_off_require_aal2 ON public.professional_time_off
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');
