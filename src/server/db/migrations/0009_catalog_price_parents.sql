-- Valores (service_prices) e seus "pais" (services, insurances): achado da revisão da 1B-1.
--
-- 1) Leitura pela recepção: antes só olhava o deleted_at do PRÓPRIO valor, então os valores
--    de um serviço ou convênio já REMOVIDO continuavam visíveis (com um insurance_id que a
--    recepção nem consegue mais ler). Agora o valor só aparece se o serviço E o convênio (quando
--    houver) também estiverem visíveis, isto é, não removidos.
-- 2) Gravação pelo admin: não dá para criar um valor apontando para serviço ou convênio já removido.
--    (O UPDATE segue sem essa regra de propósito: o admin precisa poder marcar como removido o
--    valor de um serviço que já foi removido.)
--
-- Segue valendo: sem DELETE; só admin grava; a política RESTRICTIVE de aal2 (0007) continua em vigor.

DROP POLICY service_prices_select_reception ON public.service_prices;--> statement-breakpoint
CREATE POLICY service_prices_select_reception ON public.service_prices
	FOR SELECT TO authenticated
	USING (
		(SELECT app.current_app_role()) = 'reception'
		AND deleted_at IS NULL
		AND EXISTS (
			SELECT 1 FROM public.services AS s
			WHERE s.id = service_prices.service_id AND s.deleted_at IS NULL
		)
		AND (
			insurance_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.insurances AS i
				WHERE i.id = service_prices.insurance_id AND i.deleted_at IS NULL
			)
		)
	);--> statement-breakpoint

DROP POLICY service_prices_insert_admin ON public.service_prices;--> statement-breakpoint
CREATE POLICY service_prices_insert_admin ON public.service_prices
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) = 'admin'
		AND EXISTS (
			SELECT 1 FROM public.services AS s
			WHERE s.id = service_prices.service_id AND s.deleted_at IS NULL
		)
		AND (
			insurance_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.insurances AS i
				WHERE i.id = service_prices.insurance_id AND i.deleted_at IS NULL
			)
		)
	);
