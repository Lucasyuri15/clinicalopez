-- Lista de espera (Fase 3B): grants mínimos, políticas de RLS de waitlist_entries e o gatilho de
-- UPDATE. A tabela, o enum, as FKs compostas, os CHECKs e o índice único vêm da 0029 (gerada pelo
-- drizzle-kit, que não modela política nem gatilho: por isso estão aqui, à mão).
--
-- DADO PESSOAL (LGPD). Quem lê waitlist_entries: admin (todas) e reception (as de paciente e de
--   profissional não removidos). NENHUMA política para o PROFISSIONAL: a espera é gestão da recepção.
--   Diferente das séries, aqui não há UUID nenhum escapando para o profissional.
-- Quem grava: admin e reception. INSERT em nome próprio, sempre "waiting", com created_at = now() e
--   sem encerramento. UPDATE só de linhas "waiting" e só nas colunas da preferência, no status e no
--   appointment_id; closed_at e closed_by NÃO têm GRANT: vêm do gatilho (o cliente não falsifica).
--   SEM DELETE e SEM TRUNCATE para ninguém: tirar da espera é status "removed".
--   Toda tabela tem a política RESTRICTIVE de aal2 (modelo: 0003, 0025 e 0028).
-- Escrita de quem não pode falha SEMPRE com 42501 na própria política.

-- Grants mínimos (modelo: 0028). service_role (chave secret, com BYPASSRLS) não altera nem apaga.
REVOKE ALL ON TABLE public.waitlist_entries FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.waitlist_entries TO authenticated;--> statement-breakpoint
GRANT UPDATE (professional_id, weekdays, start_minute, end_minute, note, status, appointment_id)
	ON TABLE public.waitlist_entries TO authenticated;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.waitlist_entries FROM service_role;--> statement-breakpoint

-- waitlist_entries: leitura
CREATE POLICY waitlist_entries_select_admin ON public.waitlist_entries
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY waitlist_entries_select_reception ON public.waitlist_entries
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = waitlist_entries.patient_id AND pa.deleted_at IS NULL
		)
		AND (
			waitlist_entries.professional_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.professionals AS pr
				WHERE pr.id = waitlist_entries.professional_id AND pr.deleted_at IS NULL
			)
		)
	);--> statement-breakpoint

-- waitlist_entries: pôr na espera (só admin e reception; em nome próprio; sempre "waiting", aberta e
-- sem atendimento). Paciente e serviço ativos e, se houver, profissional ativo (como appointments).
CREATE POLICY waitlist_entries_insert_staff ON public.waitlist_entries
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) IN ('admin', 'reception')
		AND created_by = (SELECT auth.uid())
		AND created_at = now()
		AND status = 'waiting'
		AND appointment_id IS NULL
		AND closed_by IS NULL
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = waitlist_entries.patient_id AND pa.deleted_at IS NULL
		)
		AND EXISTS (
			SELECT 1 FROM public.services AS sv
			WHERE sv.id = waitlist_entries.service_id AND sv.deleted_at IS NULL AND sv.active
		)
		AND (
			waitlist_entries.professional_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.professionals AS pr
				WHERE pr.id = waitlist_entries.professional_id AND pr.deleted_at IS NULL AND pr.active
			)
		)
	);--> statement-breakpoint

-- waitlist_entries: editar, atender e tirar da espera. SÓ linhas "waiting" (USING); a linha nova pode
-- ser "waiting", "fulfilled" ou "removed" (o gatilho decide as transições). A recepção só mexe no que
-- enxerga (paciente e profissional não removidos), como na leitura. Encerrar não exige profissional
-- ativo: um profissional desativado não pode prender a espera.
CREATE POLICY waitlist_entries_update_admin ON public.waitlist_entries
	FOR UPDATE TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'admin'
		AND status = 'waiting'
	)
	WITH CHECK (
		(SELECT app.current_app_role()) = 'admin'
		AND (
			waitlist_entries.professional_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.professionals AS pr
				WHERE pr.id = waitlist_entries.professional_id AND pr.deleted_at IS NULL
			)
		)
	);--> statement-breakpoint
CREATE POLICY waitlist_entries_update_reception ON public.waitlist_entries
	FOR UPDATE TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND status = 'waiting'
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = waitlist_entries.patient_id AND pa.deleted_at IS NULL
		)
		AND (
			waitlist_entries.professional_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.professionals AS pr
				WHERE pr.id = waitlist_entries.professional_id AND pr.deleted_at IS NULL
			)
		)
	)
	WITH CHECK (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = waitlist_entries.patient_id AND pa.deleted_at IS NULL
		)
		AND (
			waitlist_entries.professional_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.professionals AS pr
				WHERE pr.id = waitlist_entries.professional_id AND pr.deleted_at IS NULL
			)
		)
	);--> statement-breakpoint
CREATE POLICY waitlist_entries_require_aal2 ON public.waitlist_entries
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');--> statement-breakpoint

-- GATILHO de UPDATE: o que a RLS e os GRANTs por coluna não dizem.
--   * só admin e reception;
--   * uma espera encerrada (fulfilled/removed) é imutável;
--   * id, paciente, serviço, especialidade, autor e criação nunca mudam;
--   * ao encerrar, closed_at = now() e closed_by = quem está logado (o cliente não informa);
--   * "fulfilled" só aponta para um atendimento do MESMO paciente e do MESMO serviço (e do mesmo
--     profissional, se a espera pedia um). A leitura do atendimento segue a RLS de quem atende.
-- uid nulo (dono do banco, manutenção) passa direto, como na 0025. A função não é executável por
-- ninguém (o gatilho roda mesmo assim, como na 0025).
CREATE OR REPLACE FUNCTION app.waitlist_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
	v_uid uuid := (SELECT auth.uid());
	v_role public.user_role;
BEGIN
	IF v_uid IS NULL THEN
		RETURN NEW;
	END IF;

	v_role := app.current_app_role();
	IF v_role IS NULL OR v_role NOT IN ('admin', 'reception') THEN
		RAISE EXCEPTION 'Sem permissão para alterar a lista de espera.' USING ERRCODE = '42501';
	END IF;

	IF OLD.status <> 'waiting' THEN
		RAISE EXCEPTION 'Espera encerrada não pode ser alterada.' USING ERRCODE = '42501';
	END IF;

	IF NEW.id <> OLD.id
		OR NEW.patient_id <> OLD.patient_id
		OR NEW.service_id <> OLD.service_id
		OR NEW.specialty <> OLD.specialty
		OR NEW.created_by <> OLD.created_by
		OR NEW.created_at <> OLD.created_at THEN
		RAISE EXCEPTION 'Esses campos da espera não podem ser alterados.' USING ERRCODE = '42501';
	END IF;

	IF NEW.status = 'waiting' THEN
		NEW.closed_at := NULL;
		NEW.closed_by := NULL;
	ELSE
		NEW.closed_at := now();
		NEW.closed_by := v_uid;
		IF NEW.status = 'fulfilled' AND NOT EXISTS (
			SELECT 1 FROM public.appointments AS ap
			WHERE ap.id = NEW.appointment_id
				AND ap.patient_id = NEW.patient_id
				AND ap.service_id = NEW.service_id
				AND (NEW.professional_id IS NULL OR ap.professional_id = NEW.professional_id)
		) THEN
			RAISE EXCEPTION 'O atendimento não corresponde a esta espera.' USING ERRCODE = '23514';
		END IF;
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.waitlist_guard_update() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER waitlist_guard_update
	BEFORE UPDATE ON public.waitlist_entries
	FOR EACH ROW EXECUTE FUNCTION app.waitlist_guard_update();
