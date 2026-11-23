-- Lista de espera (Fase 3B): endurece o gatilho de UPDATE (a 0031 inteira, com TRÊS mudanças) depois da
-- revisão independente. A 0032 (gerada) acrescentou o índice único de appointment_id e o CHECK que liga
-- closed_by a closed_at. A 0031 já está aplicada: por isso é migração nova.
--
--   1. "fulfilled" só aceita um atendimento que NÃO esteja cancelado (uma espera "atendida" por um
--      atendimento que não existe mais não vale) e que tenha sido criado DEPOIS da espera (um atendimento
--      anterior não a atende). O índice único da 0032 impede o mesmo atendimento em duas esperas.
--   2. Ao encerrar (fulfilled ou removed), o profissional da espera não pode mudar no mesmo UPDATE: trocar
--      ou soltar o profissional e atender com o de outro contornaria o que o paciente pediu.
--   3. Nenhuma outra regra mudou. CREATE OR REPLACE mantém o trigger e as permissões da função.

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

	-- Profissional NOVO (trocado, não só mantido): ativo e não removido, como ao pôr na espera.
	IF NEW.professional_id IS NOT NULL
		AND NEW.professional_id IS DISTINCT FROM OLD.professional_id
		AND NOT EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.id = NEW.professional_id AND pr.deleted_at IS NULL AND pr.active
		) THEN
		RAISE EXCEPTION 'Profissional inválido para esta espera.' USING ERRCODE = '42501';
	END IF;

	IF NEW.status = 'waiting' THEN
		NEW.closed_at := NULL;
		NEW.closed_by := NULL;
	ELSE
		-- Ao encerrar, o profissional pedido não muda (senão o pedido do paciente seria contornado).
		IF NEW.professional_id IS DISTINCT FROM OLD.professional_id THEN
			RAISE EXCEPTION 'O profissional da espera não pode mudar ao encerrá-la.' USING ERRCODE = '42501';
		END IF;
		NEW.closed_at := now();
		NEW.closed_by := v_uid;
		IF NEW.status = 'fulfilled' AND NOT EXISTS (
			SELECT 1 FROM public.appointments AS ap
			WHERE ap.id = NEW.appointment_id
				AND ap.patient_id = NEW.patient_id
				AND ap.service_id = NEW.service_id
				AND ap.status <> 'cancelled'
				AND ap.created_at >= OLD.created_at
				AND (NEW.professional_id IS NULL OR ap.professional_id = NEW.professional_id)
		) THEN
			RAISE EXCEPTION 'O atendimento não corresponde a esta espera.' USING ERRCODE = '23514';
		END IF;
	END IF;
	RETURN NEW;
END
$$;
