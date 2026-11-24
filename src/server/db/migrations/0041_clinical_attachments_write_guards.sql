-- Anexos clínicos (Fase 4B-1): políticas de ESCRITA e gatilhos de clinical_attachments, e a política
-- de INSERT do log de acesso estendida aos anexos. Os grants, a leitura e o aal2 vêm da 0040; a
-- tabela e o novo CHECK do log (`clinical_access_log_target_check`), da 0039.
--
-- Quem grava:
--   clinical_attachments -> SÓ o profissional AUTOR (o cadastro ativo e não removido ligado ao login),
--     em paciente que ele enxerga e, se informar atendimento, num atendimento REALIZADO dele. Nasce
--     sem `removed_*`, com `created_by = auth.uid()` e `created_at = now()` (do banco). O UPDATE só
--     alcança linhas NÃO removidas e só as colunas `removed_at`/`removed_by` (GRANT): REMOVER é lógico
--     e acontece uma vez; o gatilho carimba `removed_at`/`removed_by` e nunca deixa mudar a identidade
--     nem o conteúdo (caminho, nome, tipo, tamanho, hash), desfazer a remoção ou remover o de outro.
--     Admin e recepção NÃO anexam nem removem.
--   clinical_access_log -> como na 0038 (admin e profissional, em nome próprio, papel e hora do
--     banco), agora também com as ações de anexo: o `attachment_id` precisa ser de um anexo que a
--     pessoa enxerga e do MESMO paciente do registro; e vale também um paciente que a pessoa não
--     enxerga mais, desde que ela enxergue um anexo dele (o autor continua lendo e registrando o que
--     é dele depois de desvinculado, como nas evoluções).
-- Sem DELETE para ninguém. O gatilho de INSERT dispara ANTES do WITH CHECK da política, então ele
-- mesmo recusa com 42501 quem não pode (sem revelar paciente, atendimento ou anexo que a pessoa não
-- enxerga: o que ela não vê "não existe"); a regra de negócio vira 23514. Mensagens fixas.

CREATE POLICY clinical_attachments_insert_author ON public.clinical_attachments
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) = 'professional'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = clinical_attachments.professional_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL AND pr.active
		)
		AND created_by = (SELECT auth.uid())
		AND created_at = now()
		AND removed_at IS NULL
		AND removed_by IS NULL
	);--> statement-breakpoint

-- Remover: SÓ linhas não removidas do próprio autor (USING); o gatilho decide o resto.
CREATE POLICY clinical_attachments_update_author ON public.clinical_attachments
	FOR UPDATE TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'professional'
		AND removed_at IS NULL
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = clinical_attachments.professional_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL AND pr.active
		)
	)
	WITH CHECK (
		(SELECT app.current_app_role()) = 'professional'
		AND removed_at IS NOT NULL
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = clinical_attachments.professional_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL AND pr.active
		)
	);--> statement-breakpoint

-- Log: a política da 0038 passa a conhecer o anexo.
DROP POLICY clinical_access_log_insert ON public.clinical_access_log;--> statement-breakpoint
CREATE POLICY clinical_access_log_insert ON public.clinical_access_log
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) IN ('admin', 'professional')
		AND user_id = (SELECT auth.uid())
		AND role = (SELECT app.current_app_role())
		AND at = now()
		AND (
			EXISTS (SELECT 1 FROM public.patients AS pa WHERE pa.id = clinical_access_log.patient_id)
			OR EXISTS (SELECT 1 FROM public.clinical_notes AS n WHERE n.patient_id = clinical_access_log.patient_id)
			OR EXISTS (SELECT 1 FROM public.clinical_attachments AS a WHERE a.patient_id = clinical_access_log.patient_id)
		)
		AND (
			note_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.clinical_notes AS n
				WHERE n.id = clinical_access_log.note_id AND n.patient_id = clinical_access_log.patient_id
			)
		)
		AND (
			attachment_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.clinical_attachments AS a
				WHERE a.id = clinical_access_log.attachment_id AND a.patient_id = clinical_access_log.patient_id
			)
		)
	);--> statement-breakpoint

-- Gatilho de INSERT: só o profissional, em nome do cadastro dele, em paciente que enxerga e, se houver
-- atendimento, num que enxerga (os dele) e REALIZADO. O dono do banco e a manutenção (sem
-- `auth.uid()`) passam.
CREATE OR REPLACE FUNCTION app.clinical_attachments_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
	v_uid uuid := (SELECT auth.uid());
	v_status text;
BEGIN
	IF v_uid IS NULL THEN
		RETURN NEW;
	END IF;
	IF (SELECT app.current_app_role()) IS DISTINCT FROM 'professional' THEN
		RAISE EXCEPTION 'clinical attachment: not allowed' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM public.professionals AS pr
		WHERE pr.id = NEW.professional_id AND pr.profile_id = v_uid AND pr.deleted_at IS NULL AND pr.active
	) THEN
		RAISE EXCEPTION 'clinical attachment: not allowed' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (SELECT 1 FROM public.patients AS pa WHERE pa.id = NEW.patient_id) THEN
		RAISE EXCEPTION 'clinical attachment: not allowed' USING ERRCODE = '42501';
	END IF;
	IF NEW.appointment_id IS NOT NULL THEN
		SELECT ap.status INTO v_status FROM public.appointments AS ap WHERE ap.id = NEW.appointment_id;
		IF NOT FOUND THEN
			RAISE EXCEPTION 'clinical attachment: not allowed' USING ERRCODE = '42501';
		END IF;
		IF v_status <> 'done' THEN
			RAISE EXCEPTION 'clinical attachment: appointment is not done' USING ERRCODE = '23514';
		END IF;
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.clinical_attachments_guard_insert() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER clinical_attachments_guard_insert
	BEFORE INSERT ON public.clinical_attachments
	FOR EACH ROW EXECUTE FUNCTION app.clinical_attachments_guard_insert();--> statement-breakpoint

-- Gatilho de UPDATE: só o autor; só a remoção (`removed_at`/`removed_by` carimbados pelo banco); o
-- removido não muda de novo nem volta; a identidade e o conteúdo nunca mudam.
CREATE OR REPLACE FUNCTION app.clinical_attachments_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
	v_uid uuid := (SELECT auth.uid());
BEGIN
	IF v_uid IS NULL THEN
		RETURN NEW;
	END IF;
	IF (SELECT app.current_app_role()) IS DISTINCT FROM 'professional' THEN
		RAISE EXCEPTION 'clinical attachment: not allowed' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM public.professionals AS pr
		WHERE pr.id = OLD.professional_id AND pr.profile_id = v_uid AND pr.deleted_at IS NULL AND pr.active
	) THEN
		RAISE EXCEPTION 'clinical attachment: not allowed' USING ERRCODE = '42501';
	END IF;
	IF OLD.removed_at IS NOT NULL THEN
		RAISE EXCEPTION 'clinical attachment: removed attachments are locked' USING ERRCODE = '42501';
	END IF;
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
		OR NEW.professional_id IS DISTINCT FROM OLD.professional_id
		OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
		OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
		OR NEW.original_name IS DISTINCT FROM OLD.original_name
		OR NEW.content_type IS DISTINCT FROM OLD.content_type
		OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
		OR NEW.sha256 IS DISTINCT FROM OLD.sha256
		OR NEW.created_by IS DISTINCT FROM OLD.created_by
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'clinical attachment: identity and content are immutable' USING ERRCODE = '42501';
	END IF;
	IF NEW.removed_at IS NULL THEN
		RAISE EXCEPTION 'clinical attachment: the only change allowed is removal' USING ERRCODE = '42501';
	END IF;
	NEW.removed_at := now();
	NEW.removed_by := v_uid;
	RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.clinical_attachments_guard_update() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER clinical_attachments_guard_update
	BEFORE UPDATE ON public.clinical_attachments
	FOR EACH ROW EXECUTE FUNCTION app.clinical_attachments_guard_update();
