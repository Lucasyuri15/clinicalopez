-- Consentimentos LGPD (1B-3b): grants mínimos e políticas de RLS de patient_consents. A tabela, as
-- chaves e os checks vêm da 0021 (gerada pelo drizzle-kit).
--
-- DADO PESSOAL (LGPD). Histórico SÓ DE INCLUSÃO: o único privilégio de escrita é INSERT. Não há
-- UPDATE nem DELETE para ninguém, nem o admin (sem privilégio, o Postgres recusa com 42501 antes de
-- olhar política). Corrigir um registro errado é lançar um novo evento. Quem lê e quem registra:
--   admin -> lê todos (inclusive de paciente removido); registra para paciente não removido.
--   reception -> lê e registra, só de paciente não removido (mesma regra de patient_private).
--   professional -> NENHUMA política: não vê consentimento nenhum, nem de paciente dele.
-- Quem é admin/reception/professional vem de app.current_app_role() (lê profiles: ativo e não
-- removido), não do JWT. Quem registrou vem de auth.uid() (DEFAULT na coluna) e a política exige
-- que seja o próprio usuário: ninguém registra em nome de outro. Política RESTRICTIVE de aal2 (modelo: 0003).
-- Escrita de quem não pode falha SEMPRE com 42501 na própria política (antes de qualquer constraint).

REVOKE ALL ON TABLE public.patient_consents FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.patient_consents TO authenticated;--> statement-breakpoint

CREATE POLICY patient_consents_select_admin ON public.patient_consents
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY patient_consents_select_reception ON public.patient_consents
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = patient_consents.patient_id AND pa.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY patient_consents_insert_staff ON public.patient_consents
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) IN ('admin', 'reception')
		AND registered_by = (SELECT auth.uid())
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = patient_consents.patient_id AND pa.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY patient_consents_require_aal2 ON public.patient_consents
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');
