-- Anexos clínicos (Fase 4B-1): grants mínimos, leitura e `aal2` de clinical_attachments. A tabela, as
-- chaves e os CHECKs vêm da 0039 (gerada pelo drizzle-kit, que não modela política nem gatilho: por
-- isso estão aqui, à mão). As políticas de ESCRITA e os gatilhos entram na 0041; até lá o INSERT e o
-- UPDATE não passam (sem política, a RLS nega).
--
-- DADO DE SAÚDE SENSÍVEL (LGPD). Mesmo sigilo da evolução (0035). Quem lê:
--   admin (tudo, inclusive os anexos removidos) e o PROFISSIONAL AUTOR: o profissional ATIVO e não
--   removido cujo `profile_id` é o login (`auth.uid()`) e cujo id é o `professional_id` do anexo. O
--   acesso é pelo AUTOR e NUNCA pelo vínculo paciente↔profissional (a recepção edita esse vínculo):
--   dois profissionais no mesmo paciente não leem os anexos um do outro, e remover ou desvincular o
--   paciente não tira o anexo do autor. O autor ainda LÊ a linha dos seus anexos removidos (o app os
--   esconde; o Storage deixa de entregar o arquivo removido a quem não é admin: 0042).
--   NENHUMA política para a recepção. Quem não tem perfil, está inativo/removido ou só tem `aal1`
--   não lê nada. A política RESTRICTIVE de aal2 vale para tudo (modelo: 0003, 0025, 0030 e 0035).
-- Sem DELETE e sem TRUNCATE para ninguém; o UPDATE existe só por coluna (`removed_at`, `removed_by`):
-- remover é LÓGICO e o arquivo nunca é apagado do Storage.

-- Grants mínimos (modelo: 0035). service_role (chave secret, com BYPASSRLS) não altera nem apaga.
REVOKE ALL ON TABLE public.clinical_attachments FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.clinical_attachments TO authenticated;--> statement-breakpoint
GRANT UPDATE (removed_at, removed_by) ON TABLE public.clinical_attachments TO authenticated;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
	ON TABLE public.clinical_attachments FROM service_role;--> statement-breakpoint

CREATE POLICY clinical_attachments_select_admin ON public.clinical_attachments
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY clinical_attachments_select_author ON public.clinical_attachments
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'professional'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = clinical_attachments.professional_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL AND pr.active
		)
	);--> statement-breakpoint

-- aal2: a URL e a chave publishable são públicas e a Data API aceita um JWT só de senha; a RLS também
-- exige o 2FA (modelo: 0003).
CREATE POLICY clinical_attachments_require_aal2 ON public.clinical_attachments
	AS RESTRICTIVE FOR ALL TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');
