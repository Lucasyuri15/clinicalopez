-- Lista de espera (Fase 3B): correção da 0030, achada pelo teste de RLS de escrita.
--
-- DEFEITO: as políticas de UPDATE exigiam, na linha NOVA, que o profissional da espera não estivesse
-- removido. Como o WITH CHECK também vale ao ENCERRAR, uma espera ligada a um profissional removido
-- depois do cadastro não podia ser tirada da lista por ninguém (nem pelo admin) sem antes trocar o
-- profissional. O comentário da 0030 já dizia que encerrar não exige profissional ativo.
--
-- CORREÇÃO: o WITH CHECK deixa de olhar o profissional e o gatilho passa a exigir profissional ATIVO e
-- não removido só quando o profissional MUDA (a política não enxerga a linha antiga; o gatilho sim).
-- Encerrar, ou editar dias, faixa e nota, mantendo o mesmo profissional, volta a funcionar. A FK
-- composta continua garantindo que o profissional existe e é da mesma especialidade. A 0030 já está
-- aplicada: por isso a correção é uma migração nova, não uma edição dela.

ALTER POLICY waitlist_entries_update_admin ON public.waitlist_entries
	WITH CHECK ((SELECT app.current_app_role()) = 'admin');--> statement-breakpoint
ALTER POLICY waitlist_entries_update_reception ON public.waitlist_entries
	WITH CHECK (
		(SELECT app.current_app_role()) = 'reception'
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = waitlist_entries.patient_id AND pa.deleted_at IS NULL
		)
	);--> statement-breakpoint

-- GATILHO: a 0030 inteira, com UMA mudança (o bloco "profissional novo"). CREATE OR REPLACE mantém o
-- trigger e as permissões da função.
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
$$;
