-- Prontuário (Fase 4A): políticas de ESCRITA e gatilhos de clinical_notes, clinical_note_addenda e
-- clinical_access_log. Os grants, a leitura e o aal2 vêm da 0035; as tabelas, da 0034.
--
-- Quem grava:
--   clinical_notes -> SÓ o profissional AUTOR (o cadastro ativo e não removido ligado ao login), no
--     atendimento REALIZADO dele. Nasce sempre `draft`, com `created_at`/`updated_at` = now() e sem
--     `finalized_*`. O UPDATE só alcança linhas `draft` (USING) e as colunas `body` e `status` (GRANT);
--     finalizar (`draft -> finalized`) carimba `finalized_at`/`finalized_by` e NÃO aceita mudar o
--     texto junto (o que foi finalizado é exatamente o rascunho salvo). A evolução FINALIZADA é
--     trancada: nem o autor altera (o gatilho é a última barreira, caso a RLS seja desligada).
--     Admin e recepção NÃO gravam evolução.
--   clinical_note_addenda -> SÓ o autor, em evolução FINALIZADA dele (a leitura da evolução já é
--     restrita ao autor), com `created_by = auth.uid()` e `created_at = now()`.
--   clinical_access_log -> admin e profissional, em nome próprio (`user_id`), com o papel e a hora do
--     banco, de paciente que a pessoa enxerga e, se houver evolução, de uma do MESMO paciente que ela
--     enxerga. Nunca guarda texto.
-- Sem DELETE para ninguém. Adendo e log nunca mudam (sem UPDATE).
-- O gatilho de INSERT dispara ANTES do WITH CHECK da política, então ele mesmo recusa com 42501 quem
-- não pode (sem revelar atendimento ou evolução que a pessoa não enxerga: o que ela não vê "não
-- existe"); a regra de negócio vira 23514. Mensagens fixas, sem dado de paciente.

-- clinical_notes: criar o rascunho
CREATE POLICY clinical_notes_insert_author ON public.clinical_notes
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) = 'professional'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = clinical_notes.professional_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL AND pr.active
		)
		AND status = 'draft'
		AND finalized_at IS NULL
		AND finalized_by IS NULL
		AND created_at = now()
		AND updated_at = now()
	);--> statement-breakpoint

-- clinical_notes: editar o rascunho e finalizar. SÓ linhas `draft` (USING); a linha nova pode ser
-- `draft` ou `finalized` (o gatilho decide a transição).
CREATE POLICY clinical_notes_update_author ON public.clinical_notes
	FOR UPDATE TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'professional'
		AND status = 'draft'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = clinical_notes.professional_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL AND pr.active
		)
	)
	WITH CHECK (
		(SELECT app.current_app_role()) = 'professional'
		AND status IN ('draft', 'finalized')
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = clinical_notes.professional_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL AND pr.active
		)
	);--> statement-breakpoint

-- clinical_note_addenda: adendar uma evolução finalizada do próprio autor. A subconsulta enxerga só as
-- evoluções que o autor lê (clinical_notes_select_author), então "de outro autor" não passa.
CREATE POLICY clinical_note_addenda_insert_author ON public.clinical_note_addenda
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) = 'professional'
		AND created_by = (SELECT auth.uid())
		AND created_at = now()
		AND EXISTS (
			SELECT 1 FROM public.clinical_notes AS n
			WHERE n.id = clinical_note_addenda.note_id AND n.status = 'finalized'
		)
	);--> statement-breakpoint

-- clinical_access_log: registrar o acesso (admin e profissional, em nome próprio).
CREATE POLICY clinical_access_log_insert ON public.clinical_access_log
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) IN ('admin', 'professional')
		AND user_id = (SELECT auth.uid())
		AND role = (SELECT app.current_app_role())
		AND at = now()
		AND EXISTS (SELECT 1 FROM public.patients AS pa WHERE pa.id = clinical_access_log.patient_id)
		AND (
			note_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.clinical_notes AS n
				WHERE n.id = clinical_access_log.note_id AND n.patient_id = clinical_access_log.patient_id
			)
		)
	);--> statement-breakpoint

-- Gatilho de INSERT da evolução: só o profissional, só em atendimento que ele enxerga (os dele) e que
-- esteja REALIZADO. O dono do banco e a manutenção (sem `auth.uid()`) passam.
CREATE OR REPLACE FUNCTION app.clinical_notes_guard_insert()
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
		RAISE EXCEPTION 'clinical note: not allowed' USING ERRCODE = '42501';
	END IF;
	SELECT ap.status INTO v_status FROM public.appointments AS ap WHERE ap.id = NEW.appointment_id;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'clinical note: not allowed' USING ERRCODE = '42501';
	END IF;
	IF v_status <> 'done' THEN
		RAISE EXCEPTION 'clinical note: appointment is not done' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.clinical_notes_guard_insert() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER clinical_notes_guard_insert
	BEFORE INSERT ON public.clinical_notes
	FOR EACH ROW EXECUTE FUNCTION app.clinical_notes_guard_insert();--> statement-breakpoint

-- Gatilho de UPDATE da evolução: só o autor; rascunho -> rascunho (texto) ou rascunho -> finalizada
-- (sem mudar o texto, com `finalized_*` do banco); finalizada não muda; a identidade nunca muda.
CREATE OR REPLACE FUNCTION app.clinical_notes_guard_update()
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
		RAISE EXCEPTION 'clinical note: not allowed' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM public.professionals AS pr
		WHERE pr.id = OLD.professional_id AND pr.profile_id = v_uid AND pr.deleted_at IS NULL AND pr.active
	) THEN
		RAISE EXCEPTION 'clinical note: not allowed' USING ERRCODE = '42501';
	END IF;
	IF OLD.status = 'finalized' THEN
		RAISE EXCEPTION 'clinical note: finalized notes are locked' USING ERRCODE = '42501';
	END IF;
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.appointment_id IS DISTINCT FROM OLD.appointment_id
		OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
		OR NEW.professional_id IS DISTINCT FROM OLD.professional_id
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'clinical note: identity is immutable' USING ERRCODE = '42501';
	END IF;
	IF NEW.status = 'finalized' THEN
		IF NEW.body IS DISTINCT FROM OLD.body THEN
			RAISE EXCEPTION 'clinical note: the text cannot change while finalizing' USING ERRCODE = '42501';
		END IF;
		NEW.finalized_at := now();
		NEW.finalized_by := v_uid;
	ELSIF NEW.finalized_at IS NOT NULL OR NEW.finalized_by IS NOT NULL THEN
		RAISE EXCEPTION 'clinical note: finalization is stamped by the database' USING ERRCODE = '42501';
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.clinical_notes_guard_update() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER clinical_notes_guard_update
	BEFORE UPDATE ON public.clinical_notes
	FOR EACH ROW EXECUTE FUNCTION app.clinical_notes_guard_update();--> statement-breakpoint

-- Gatilho de INSERT do adendo: só o profissional, só em evolução que ele enxerga (as dele) e que
-- esteja FINALIZADA.
CREATE OR REPLACE FUNCTION app.clinical_note_addenda_guard_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
	v_uid uuid := (SELECT auth.uid());
	v_status public.clinical_note_status;
BEGIN
	IF v_uid IS NULL THEN
		RETURN NEW;
	END IF;
	IF (SELECT app.current_app_role()) IS DISTINCT FROM 'professional' THEN
		RAISE EXCEPTION 'clinical addendum: not allowed' USING ERRCODE = '42501';
	END IF;
	SELECT n.status INTO v_status FROM public.clinical_notes AS n WHERE n.id = NEW.note_id;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'clinical addendum: not allowed' USING ERRCODE = '42501';
	END IF;
	IF v_status <> 'finalized' THEN
		RAISE EXCEPTION 'clinical addendum: the note is not finalized' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.clinical_note_addenda_guard_insert() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER clinical_note_addenda_guard_insert
	BEFORE INSERT ON public.clinical_note_addenda
	FOR EACH ROW EXECUTE FUNCTION app.clinical_note_addenda_guard_insert();
