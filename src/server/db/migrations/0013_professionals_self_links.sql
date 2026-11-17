-- Achado menor da revisão da 1B-2a: o profissional não deve ver a ligação a um serviço REMOVIDO
-- (a recepção já não vê, 0011). Simetria: a política "select_self" passa a exigir também o
-- serviço não removido. As demais regras da 0011 seguem iguais.

DROP POLICY professional_services_select_self ON public.professional_services;--> statement-breakpoint
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
		AND EXISTS (
			SELECT 1 FROM public.services AS s
			WHERE s.id = professional_services.service_id AND s.deleted_at IS NULL
		)
	);
