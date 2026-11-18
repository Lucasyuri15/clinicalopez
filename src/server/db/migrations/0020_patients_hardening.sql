-- Pacientes (1B-3a), achados menores da revisão independente da 0018:
-- 1) app.is_own_patient passa a exigir também o 2FA (aal2): dentro das políticas a RESTRICTIVE de
--    aal2 já cobria, mas uma chamada direta com aal1 confirmava o vínculo do próprio usuário.
-- 2) A política de leitura dos próprios vínculos repete `deleted_at IS NULL` do paciente: antes a
--    regra "paciente removido some" dependia da RLS de patients continuar filtrando por dentro.
-- As demais regras da 0018 seguem iguais.

CREATE OR REPLACE FUNCTION app.is_own_patient(p_patient_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
	SELECT COALESCE((SELECT app.current_app_role()) = 'professional', false)
		AND COALESCE(((SELECT auth.jwt()) ->> 'aal') = 'aal2', false)
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

DROP POLICY patient_professionals_select_self ON public.patient_professionals;--> statement-breakpoint
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
			WHERE pa.id = patient_professionals.patient_id AND pa.deleted_at IS NULL
		)
	);
