-- Prontuário (Fase 4A): grants mínimos, leitura e `aal2` de clinical_notes, clinical_note_addenda e
-- clinical_access_log. As tabelas, as chaves e os CHECKs vêm da 0034 (gerada pelo drizzle-kit, que
-- não modela política nem gatilho: por isso estão aqui, à mão). As políticas de ESCRITA e os
-- gatilhos entram na 0036; até lá o INSERT/UPDATE não passa (sem política, a RLS nega).
--
-- DADO DE SAÚDE SENSÍVEL (LGPD). Quem lê:
--   clinical_notes e clinical_note_addenda -> admin (tudo, inclusive rascunhos) e o PROFISSIONAL
--     AUTOR: o profissional ATIVO e não removido cujo `profile_id` é o login (`auth.uid()`) e cujo id
--     é o `professional_id` da evolução. O acesso é pelo AUTOR e NUNCA pelo vínculo paciente↔
--     profissional (a recepção edita esse vínculo): dois profissionais no mesmo paciente não leem um
--     ao outro, e remover ou desvincular o paciente não tira a evolução do autor. O adendo herda a
--     regra pela evolução (se a nota não é visível, o adendo também não).
--   clinical_access_log -> SÓ o admin lê. Ninguém além do admin enxerga nem as próprias linhas.
--   NENHUMA política para a recepção. Quem não tem perfil, está inativo/removido ou só tem `aal1`
--   não lê nada. Toda tabela tem a política RESTRICTIVE de aal2 (modelo: 0003, 0025 e 0030).
-- Sem DELETE e sem TRUNCATE para ninguém; o UPDATE só existe na evolução, por coluna (texto e
-- status): `finalized_*`, `updated_at` e a identidade (atendimento, paciente, profissional) vêm do
-- banco ou não mudam. Adendo e log só aceitam INSERT.

-- Grants mínimos (modelo: 0030). service_role (chave secret, com BYPASSRLS) não altera nem apaga.
REVOKE ALL ON TABLE public.clinical_notes, public.clinical_note_addenda, public.clinical_access_log
	FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.clinical_notes TO authenticated;--> statement-breakpoint
GRANT UPDATE (body, status) ON TABLE public.clinical_notes TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.clinical_note_addenda TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.clinical_access_log TO authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
	ON TABLE public.clinical_notes, public.clinical_note_addenda, public.clinical_access_log FROM service_role;--> statement-breakpoint

-- clinical_notes: leitura
CREATE POLICY clinical_notes_select_admin ON public.clinical_notes
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY clinical_notes_select_author ON public.clinical_notes
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'professional'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = clinical_notes.professional_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL AND pr.active
		)
	);--> statement-breakpoint

-- clinical_note_addenda: leitura (o profissional herda a visibilidade da evolução)
CREATE POLICY clinical_note_addenda_select_admin ON public.clinical_note_addenda
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY clinical_note_addenda_select_author ON public.clinical_note_addenda
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'professional'
		AND EXISTS (
			SELECT 1 FROM public.clinical_notes AS n
			WHERE n.id = clinical_note_addenda.note_id
		)
	);--> statement-breakpoint

-- clinical_access_log: só o admin lê
CREATE POLICY clinical_access_log_select_admin ON public.clinical_access_log
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint

-- aal2: a URL e a chave publishable são públicas e a Data API aceita um JWT só de senha; a RLS também
-- exige o 2FA (modelo: 0003).
CREATE POLICY clinical_notes_require_aal2 ON public.clinical_notes
	AS RESTRICTIVE FOR ALL TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');--> statement-breakpoint
CREATE POLICY clinical_note_addenda_require_aal2 ON public.clinical_note_addenda
	AS RESTRICTIVE FOR ALL TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');--> statement-breakpoint
CREATE POLICY clinical_access_log_require_aal2 ON public.clinical_access_log
	AS RESTRICTIVE FOR ALL TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');
