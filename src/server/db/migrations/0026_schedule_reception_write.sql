-- A recepção passa a gravar a grade semanal e as folgas/bloqueios dos profissionais.
--
-- Contexto: a 0015 deu a escrita só ao admin. A clínica usa o admin só para desenvolver; quem
-- opera a grade no dia a dia é a recepção. O profissional continua só LENDO a própria grade.
--
-- Como: acrescenta políticas PERMISSIVE de INSERT e DELETE para `reception` (somam às do admin; a
-- 0015 não é editada). Os GRANTs já existem (SELECT, INSERT, DELETE para `authenticated`). Sem
-- UPDATE para ninguém (editar a semana é apagar e recriar numa transação). A política RESTRICTIVE
-- de aal2 de cada tabela continua valendo para todos.
--
-- A recepção só escreve para profissional NÃO removido (a mesma condição do INSERT do admin; ela
-- também só LÊ os não removidos, então nenhum erro de sobreposição ou de limite revela linhas que
-- ela não enxerga: para profissional removido ou inexistente a política falha antes, com 42501).
-- Apagar as linhas de profissional removido (limpeza) continua só do admin.
-- Quem é reception vem de app.current_app_role() (lê profiles: ativo e não removido), não do JWT.

CREATE POLICY professional_work_hours_insert_reception ON public.professional_work_hours
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_work_hours.professional_id AND p.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY professional_work_hours_delete_reception ON public.professional_work_hours
	FOR DELETE TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_work_hours.professional_id AND p.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY professional_time_off_insert_reception ON public.professional_time_off
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_time_off.professional_id AND p.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY professional_time_off_delete_reception ON public.professional_time_off
	FOR DELETE TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS p
			WHERE p.id = professional_time_off.professional_id AND p.deleted_at IS NULL
		)
	);
