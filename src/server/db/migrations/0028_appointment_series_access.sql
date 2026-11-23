-- Séries e pacotes de sessões (Fase 3A): grants mínimos, políticas de RLS de appointment_series e o
-- gatilho de appointments reescrito para tornar series_id imutável. A tabela, a coluna series_id e a
-- FK composta vêm da 0027 (gerada pelo drizzle-kit, que não modela política nem gatilho: por isso
-- estão aqui, à mão). O conflito de horário NÃO muda: as exclusões da 0025 continuam sendo a barreira
-- final de cada sessão, série ou avulsa.
--
-- DADO PESSOAL (LGPD). Quem lê appointment_series: admin (todas) e reception (as de profissional não
--   removido). NENHUMA política para o PROFISSIONAL: a série é gestão da recepção, e o profissional
--   continua vendo só os próprios atendimentos (a coluna series_id em appointments é só um UUID).
-- Quem grava: admin e reception criam a série (em nome próprio, com created_at = now()). SEM UPDATE e
--   SEM DELETE para ninguém: a série é identidade imutável; encerrar é cancelar as sessões abertas.
--   Toda tabela tem a política RESTRICTIVE de aal2 (modelo: 0003 e 0025).
-- Escrita de quem não pode falha SEMPRE com 42501 na própria política.

-- Grants mínimos (modelo: 0025). service_role (chave secret, com BYPASSRLS) não altera nem apaga.
REVOKE ALL ON TABLE public.appointment_series FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.appointment_series TO authenticated;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.appointment_series FROM service_role;--> statement-breakpoint

-- appointment_series: leitura
CREATE POLICY appointment_series_select_admin ON public.appointment_series
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY appointment_series_select_reception ON public.appointment_series
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = appointment_series.professional_id AND pr.deleted_at IS NULL
		)
	);--> statement-breakpoint

-- appointment_series: criar (só admin e reception; em nome próprio; created_at é o now() da transação,
-- o mesmo das sessões que nascem junto). Mesmas condições de existência de appointments_insert_staff.
CREATE POLICY appointment_series_insert_staff ON public.appointment_series
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) IN ('admin', 'reception')
		AND created_by = (SELECT auth.uid())
		AND created_at = now()
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = appointment_series.professional_id AND pr.deleted_at IS NULL AND pr.active
		)
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = appointment_series.patient_id AND pa.deleted_at IS NULL
		)
		AND EXISTS (
			SELECT 1 FROM public.services AS sv
			WHERE sv.id = appointment_series.service_id AND sv.deleted_at IS NULL AND sv.active
		)
	);--> statement-breakpoint
CREATE POLICY appointment_series_require_aal2 ON public.appointment_series
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');--> statement-breakpoint

-- GATILHO de appointments: a 0025 inteira, com UMA mudança: series_id passa a ser imutável (junto de
-- id, profissional, paciente, serviço, especialidade, autor e criação). series_id é anulável, então a
-- comparação é IS DISTINCT FROM (um avulso não vira sessão de série nem o contrário, e uma sessão não
-- troca de série). O GRANT UPDATE por coluna da 0025 continua sem series_id: esta é a segunda
-- barreira. CREATE OR REPLACE mantém o trigger e as permissões da função.
CREATE OR REPLACE FUNCTION app.appointments_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
	v_uid uuid := (SELECT auth.uid());
	v_role public.user_role;
	v_time_changed boolean;
	v_status_changed boolean;
	v_allowed boolean;
BEGIN
	IF v_uid IS NULL THEN
		NEW.updated_at := now();
		RETURN NEW;
	END IF;

	v_role := app.current_app_role();
	IF v_role IS NULL THEN
		RAISE EXCEPTION 'Sem permissão para alterar o atendimento.' USING ERRCODE = '42501';
	END IF;

	IF OLD.status = 'cancelled' THEN
		RAISE EXCEPTION 'Atendimento cancelado não pode ser alterado.' USING ERRCODE = '42501';
	END IF;

	IF NEW.id <> OLD.id
		OR NEW.professional_id <> OLD.professional_id
		OR NEW.patient_id <> OLD.patient_id
		OR NEW.service_id <> OLD.service_id
		OR NEW.specialty <> OLD.specialty
		OR NEW.series_id IS DISTINCT FROM OLD.series_id
		OR NEW.created_by <> OLD.created_by
		OR NEW.created_at <> OLD.created_at THEN
		RAISE EXCEPTION 'Esses campos do atendimento não podem ser alterados.' USING ERRCODE = '42501';
	END IF;

	v_time_changed := NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at;
	v_status_changed := NEW.status IS DISTINCT FROM OLD.status;

	IF v_time_changed THEN
		IF v_role = 'professional'
			OR OLD.status NOT IN ('scheduled', 'confirmed')
			OR NEW.status <> 'scheduled'
			OR NEW.cancel_reason IS NOT NULL THEN
			RAISE EXCEPTION 'Sem permissão para remarcar este atendimento.' USING ERRCODE = '42501';
		END IF;
		IF NEW.starts_at < now() THEN
			RAISE EXCEPTION 'O novo horário já passou.' USING ERRCODE = '23514';
		END IF;
	ELSIF v_status_changed THEN
		v_allowed := CASE v_role
			WHEN 'admin' THEN (OLD.status, NEW.status) IN (
				('scheduled', 'confirmed'), ('scheduled', 'done'), ('scheduled', 'no_show'), ('scheduled', 'cancelled'),
				('confirmed', 'done'), ('confirmed', 'no_show'), ('confirmed', 'cancelled'),
				('done', 'no_show'), ('no_show', 'done')
			)
			WHEN 'reception' THEN (OLD.status, NEW.status) IN (
				('scheduled', 'confirmed'), ('scheduled', 'done'), ('scheduled', 'no_show'), ('scheduled', 'cancelled'),
				('confirmed', 'done'), ('confirmed', 'no_show'), ('confirmed', 'cancelled')
			)
			WHEN 'professional' THEN (OLD.status, NEW.status) IN (
				('scheduled', 'done'), ('scheduled', 'no_show'),
				('confirmed', 'done'), ('confirmed', 'no_show')
			)
			ELSE false
		END;
		IF NOT v_allowed THEN
			RAISE EXCEPTION 'Essa mudança de status não é permitida.' USING ERRCODE = '42501';
		END IF;
		IF NEW.status IN ('done', 'no_show') AND NEW.starts_at > now() THEN
			RAISE EXCEPTION 'Só é possível registrar depois do início do atendimento.' USING ERRCODE = '23514';
		END IF;
	END IF;

	IF v_status_changed THEN
		NEW.status_changed_at := now();
		NEW.status_changed_by := v_uid;
	ELSE
		NEW.status_changed_at := OLD.status_changed_at;
		NEW.status_changed_by := OLD.status_changed_by;
	END IF;
	NEW.updated_at := now();
	RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.appointments_guard_update() FROM PUBLIC, anon, authenticated;
