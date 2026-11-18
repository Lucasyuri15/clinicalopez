-- Pacientes (1B-3a): grants mínimos e políticas de RLS de patients, patient_private e
-- patient_professionals. As tabelas, as chaves e os checks vêm da 0017 (gerada pelo drizzle-kit).
--
-- DADO PESSOAL E DE SAÚDE (LGPD). Quem lê:
--   patients (nome, nascimento, telefone, e-mail) -> admin (todos); reception (não removidos); o
--     PROFISSIONAL só os pacientes VINCULADOS a ele (patient_professionals), não removidos, e só
--     enquanto o cadastro dele estiver ativo e não removido e o login vinculado e ativo.
--   patient_private (CPF, endereço, convênio, responsável, observações) -> SÓ admin e reception
--     (não removidos). Não existe política para o profissional: a RLS é por linha, então o dado
--     que ele nunca pode ver é tabela própria, e sem política não vê nada (nem de paciente dele).
--   patient_professionals (vínculo) -> admin (todos); reception (paciente e profissional não
--     removidos); o profissional SÓ os próprios vínculos (nunca o de um colega no mesmo paciente).
-- Quem grava: admin e reception criam e editam (patients, patient_private) e vinculam/desvinculam;
--   SÓ o admin remove (soft delete: deleted_at) ou restaura. Sem DELETE físico em patients e
--   patient_private; patient_professionals é ligação (configuração): admin e reception apagam.
-- Quem é admin/reception/professional vem de app.current_app_role() (lê profiles: ativo e não
-- removido), não do JWT. Toda tabela tem a política RESTRICTIVE de aal2 (modelo: 0003).
-- Escrita de quem não pode falha SEMPRE com 42501 na própria política (antes de qualquer
-- constraint), então um erro de CPF duplicado nunca revela um paciente que a pessoa não vê.

-- "Este paciente é meu?" para a política de patients. SECURITY DEFINER de propósito: a política de
-- patients lê patient_professionals e a de patient_professionals lê patients; sem a função, o
-- Postgres recusaria a recursão entre políticas. Só confirma o vínculo do PRÓPRIO usuário logado
-- (auth.uid()), nunca de outro; sem parâmetro de usuário, não serve para espiar vínculos alheios.
CREATE OR REPLACE FUNCTION app.is_own_patient(p_patient_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
	SELECT COALESCE((SELECT app.current_app_role()) = 'professional', false)
		AND EXISTS (
			SELECT 1
			FROM public.patient_professionals AS pp
			JOIN public.professionals AS pr ON pr.id = pp.professional_id
			WHERE pp.patient_id = p_patient_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL
				AND pr.active
		)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.is_own_patient(uuid) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_own_patient(uuid) TO authenticated;--> statement-breakpoint

REVOKE ALL ON TABLE public.patients, public.patient_private, public.patient_professionals FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.patients TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.patient_private TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE public.patient_professionals TO authenticated;--> statement-breakpoint

-- patients
CREATE POLICY patients_select_admin ON public.patients
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY patients_select_reception ON public.patients
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'reception' AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY patients_select_own ON public.patients
	FOR SELECT TO authenticated
	USING (deleted_at IS NULL AND app.is_own_patient(id));--> statement-breakpoint
CREATE POLICY patients_insert_admin ON public.patients
	FOR INSERT TO authenticated
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY patients_insert_reception ON public.patients
	FOR INSERT TO authenticated
	WITH CHECK ((SELECT app.current_app_role()) = 'reception' AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY patients_update_admin ON public.patients
	FOR UPDATE TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin')
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
-- A recepção edita, mas não remove (deleted_at precisa continuar nulo) nem mexe em removido.
CREATE POLICY patients_update_reception ON public.patients
	FOR UPDATE TO authenticated
	USING ((SELECT app.current_app_role()) = 'reception' AND deleted_at IS NULL)
	WITH CHECK ((SELECT app.current_app_role()) = 'reception' AND deleted_at IS NULL);--> statement-breakpoint
CREATE POLICY patients_require_aal2 ON public.patients
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');--> statement-breakpoint

-- patient_private (NENHUMA política para o profissional)
CREATE POLICY patient_private_select_admin ON public.patient_private
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY patient_private_select_reception ON public.patient_private
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = patient_private.patient_id AND pa.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY patient_private_insert_staff ON public.patient_private
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) IN ('admin', 'reception')
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = patient_private.patient_id AND pa.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY patient_private_update_admin ON public.patient_private
	FOR UPDATE TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin')
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY patient_private_update_reception ON public.patient_private
	FOR UPDATE TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = patient_private.patient_id AND pa.deleted_at IS NULL
		)
	)
	WITH CHECK (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = patient_private.patient_id AND pa.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY patient_private_require_aal2 ON public.patient_private
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');--> statement-breakpoint

-- patient_professionals
CREATE POLICY patient_professionals_select_admin ON public.patient_professionals
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY patient_professionals_select_reception ON public.patient_professionals
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = patient_professionals.patient_id AND pa.deleted_at IS NULL
		)
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = patient_professionals.professional_id AND pr.deleted_at IS NULL
		)
	);--> statement-breakpoint
-- O profissional vê SÓ a linha do próprio vínculo (profissional = ele), nunca a de um colega.
CREATE POLICY patient_professionals_select_self ON public.patient_professionals
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'professional'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = patient_professionals.professional_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL
				AND pr.active
		)
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = patient_professionals.patient_id
		)
	);--> statement-breakpoint
CREATE POLICY patient_professionals_insert_staff ON public.patient_professionals
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) IN ('admin', 'reception')
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = patient_professionals.patient_id AND pa.deleted_at IS NULL
		)
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = patient_professionals.professional_id AND pr.deleted_at IS NULL AND pr.active
		)
	);--> statement-breakpoint
CREATE POLICY patient_professionals_delete_staff ON public.patient_professionals
	FOR DELETE TO authenticated
	USING ((SELECT app.current_app_role()) IN ('admin', 'reception'));--> statement-breakpoint
CREATE POLICY patient_professionals_require_aal2 ON public.patient_professionals
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');
