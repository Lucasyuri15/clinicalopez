-- Agenda (Fase 2): conflito de horário, gatilho de transições, grants mínimos e políticas de RLS de
-- appointments e appointment_prices. As tabelas, as chaves e os checks vêm da 0024 (gerada pelo
-- drizzle-kit, que não modela exclusão nem gatilho: por isso estão aqui, à mão).
--
-- DADO PESSOAL E DE SAÚDE (LGPD). Quem lê:
--   appointments -> admin (todos); reception (os de profissional não removido); o PROFISSIONAL só os
--     PRÓPRIOS (profissional ativo e não removido ligado ao login dele). O nome do paciente chega ao
--     profissional pela leitura de patients, que já é filtrada pelo vínculo (patients_select_own).
--   appointment_prices (valor copiado do serviço) -> SÓ admin e reception, e só de atendimento que a
--     pessoa já enxerga. NENHUMA política para o profissional: a RLS é por linha e os três perfis são
--     o mesmo papel de banco, então o que ele nunca pode ver é tabela própria (como service_prices).
-- Quem grava: admin e reception criam (status 'scheduled'), remarcam, mudam status e cancelam; o
--   profissional só muda o status dos PRÓPRIOS atendimentos (Realizada ou Falta). SEM DELETE para
--   ninguém: cancelar é o jeito de "apagar". Sem UPDATE em appointment_prices (o valor não é editado
--   nesta fase). Quem é admin/reception/professional vem de app.current_app_role() (lê profiles:
--   ativo e não removido), não do JWT. Toda tabela tem a política RESTRICTIVE de aal2 (modelo: 0003).
-- Escrita de quem não pode falha SEMPRE com 42501 na própria política (antes de qualquer constraint),
--   então um erro de sobreposição nunca revela um atendimento que a pessoa não vê.

-- CONFLITO DE HORÁRIO é do banco. Dois atendimentos do mesmo profissional OU do mesmo paciente não
-- podem se sobrepor. Intervalo meio-aberto [início, fim): terminar às 10:00 e começar às 10:00 não
-- conflita. Só a 'cancelled' libera o horário; 'done' e 'no_show' continuam ocupando (o histórico é
-- verdadeiro). btree_gist combina igualdade (profissional/paciente) com sobreposição de intervalo.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;--> statement-breakpoint
ALTER TABLE public.appointments
	ADD CONSTRAINT appointments_professional_no_overlap
	EXCLUDE USING gist (
		professional_id WITH =,
		tstzrange(starts_at, ends_at, '[)') WITH &&
	) WHERE (status <> 'cancelled');--> statement-breakpoint
ALTER TABLE public.appointments
	ADD CONSTRAINT appointments_patient_no_overlap
	EXCLUDE USING gist (
		patient_id WITH =,
		tstzrange(starts_at, ends_at, '[)') WITH &&
	) WHERE (status <> 'cancelled');--> statement-breakpoint

-- GATILHO BEFORE UPDATE: a última barreira das regras que o GRANT por coluna não consegue impor
-- (todos os perfis são o mesmo papel de banco, então o privilégio de coluna é igual para todos).
-- O mapa de transições espelha src/lib/appointments/status.ts (um teste percorre todos os pares).
--   - Cancelada é terminal para todos.
--   - Remarcar (mudar o horário): só admin e reception, atendimento em aberto, volta para
--     'scheduled', sem motivo, e o novo início no futuro.
--   - Mudar o status: admin e reception de 'scheduled' para confirmada/realizada/falta/cancelada e
--     de 'confirmed' para realizada/falta/cancelada; o profissional só 'scheduled'/'confirmed' para
--     realizada ou falta; SÓ o admin corrige realizada <-> falta.
--   - Realizada e Falta só depois do início do atendimento.
--   - Quem mudou o status e quando vêm do banco (o cliente não falsifica); chaves, autor e criação
--     não mudam.
-- Sessão sem usuário (dono do banco, migração, manutenção) não é restringida aqui: o dono pode tudo.
-- SECURITY INVOKER e search_path vazio. Erros: 42501 (sem permissão ou transição não permitida) e
-- 23514 (regra de horário), sempre com texto fixo, sem dado de paciente.
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
REVOKE ALL ON FUNCTION app.appointments_guard_update() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE TRIGGER appointments_guard_update
	BEFORE UPDATE ON public.appointments
	FOR EACH ROW EXECUTE FUNCTION app.appointments_guard_update();--> statement-breakpoint

-- Grants mínimos. UPDATE só por coluna (modelo: 0019): chaves, autor e carimbos ficam de fora; o
-- serviço também (remarcar não troca o serviço; para isso, cancele e crie outro). Sem DELETE.
REVOKE ALL ON TABLE public.appointments, public.appointment_prices FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.appointments TO authenticated;--> statement-breakpoint
GRANT UPDATE (status, starts_at, ends_at, cancel_reason) ON TABLE public.appointments TO authenticated;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.appointment_prices TO authenticated;--> statement-breakpoint
-- service_role (chave secret, com BYPASSRLS) não altera nem apaga o histórico (como a 0023).
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.appointments, public.appointment_prices FROM service_role;--> statement-breakpoint

-- appointments: leitura
CREATE POLICY appointments_select_admin ON public.appointments
	FOR SELECT TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY appointments_select_reception ON public.appointments
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = appointments.professional_id AND pr.deleted_at IS NULL
		)
	);--> statement-breakpoint
CREATE POLICY appointments_select_own ON public.appointments
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'professional'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = appointments.professional_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL
				AND pr.active
		)
	);--> statement-breakpoint

-- appointments: criar (só admin e reception; nasce 'scheduled', no futuro, em nome próprio; os
-- carimbos são do banco: created_at e updated_at precisam ser o now() da transação)
CREATE POLICY appointments_insert_staff ON public.appointments
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) IN ('admin', 'reception')
		AND created_by = (SELECT auth.uid())
		AND status = 'scheduled'
		AND status_changed_at IS NULL
		AND status_changed_by IS NULL
		AND created_at = now()
		AND updated_at = now()
		AND starts_at >= now()
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = appointments.professional_id AND pr.deleted_at IS NULL AND pr.active
		)
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = appointments.patient_id AND pa.deleted_at IS NULL
		)
		AND EXISTS (
			SELECT 1 FROM public.services AS sv
			WHERE sv.id = appointments.service_id AND sv.deleted_at IS NULL AND sv.active
		)
	);--> statement-breakpoint

-- appointments: atualizar. Aqui só se decide QUEM chega à linha (e o estado ANTIGO dela); o que pode
-- mudar, e de qual status para qual, é do gatilho acima.
CREATE POLICY appointments_update_admin ON public.appointments
	FOR UPDATE TO authenticated
	USING ((SELECT app.current_app_role()) = 'admin')
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
CREATE POLICY appointments_update_reception ON public.appointments
	FOR UPDATE TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND status IN ('scheduled', 'confirmed')
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = appointments.professional_id AND pr.deleted_at IS NULL
		)
	)
	WITH CHECK ((SELECT app.current_app_role()) = 'reception');--> statement-breakpoint
CREATE POLICY appointments_update_own ON public.appointments
	FOR UPDATE TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'professional'
		AND status IN ('scheduled', 'confirmed')
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = appointments.professional_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL
				AND pr.active
		)
	)
	WITH CHECK (
		(SELECT app.current_app_role()) = 'professional'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = appointments.professional_id
				AND pr.profile_id = (SELECT auth.uid())
				AND pr.deleted_at IS NULL
				AND pr.active
		)
	);--> statement-breakpoint
CREATE POLICY appointments_require_aal2 ON public.appointments
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');--> statement-breakpoint

-- appointment_prices (NENHUMA política para o profissional). A linha do valor só nasce na MESMA
-- transação do atendimento: o atendimento precisa ter created_at = now().
CREATE POLICY appointment_prices_select_staff ON public.appointment_prices
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) IN ('admin', 'reception')
		AND EXISTS (
			SELECT 1 FROM public.appointments AS ap
			WHERE ap.id = appointment_prices.appointment_id
		)
	);--> statement-breakpoint
CREATE POLICY appointment_prices_insert_staff ON public.appointment_prices
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) IN ('admin', 'reception')
		AND created_at = now()
		AND EXISTS (
			SELECT 1 FROM public.appointments AS ap
			WHERE ap.id = appointment_prices.appointment_id AND ap.created_at = now()
		)
	);--> statement-breakpoint
CREATE POLICY appointment_prices_require_aal2 ON public.appointment_prices
	AS RESTRICTIVE
	FOR ALL
	TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');
