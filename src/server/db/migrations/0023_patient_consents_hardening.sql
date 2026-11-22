-- Consentimentos LGPD (1B-3b): endurecimentos apontados pela revisão independente da 0021/0022
-- (a 0022 já foi aplicada, então não é editada: esta migração a complementa, como a 0020 fez).
--
-- 1) service_role (chave secret do Supabase, com BYPASSRLS) ainda podia dar TRUNCATE no histórico
--    (o padrão do projeto já tirava UPDATE e DELETE dele; medido no dev). O app não usa essa chave
--    e a Data API está desligada; ainda assim, o histórico é só de inclusão, então tira-se tudo o
--    que altera ou apaga. O dono do banco (postgres) segue podendo tudo: risco aceito na spec.
-- 2) created_at não se falsifica: o INSERT é por tabela inteira, então o cliente poderia informar um
--    created_at antigo e mudar o "estado atual" (desempate por registro mais recente) e a prova de
--    QUANDO foi registrado. O valor padrão (now()) é aplicado antes do WITH CHECK e é o mesmo
--    now() da transação, então um registro normal passa e um created_at informado é recusado (42501).

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.patient_consents FROM service_role;--> statement-breakpoint

DROP POLICY patient_consents_insert_staff ON public.patient_consents;--> statement-breakpoint
CREATE POLICY patient_consents_insert_staff ON public.patient_consents
	FOR INSERT TO authenticated
	WITH CHECK (
		(SELECT app.current_app_role()) IN ('admin', 'reception')
		AND registered_by = (SELECT auth.uid())
		AND created_at = now()
		AND EXISTS (
			SELECT 1 FROM public.patients AS pa
			WHERE pa.id = patient_consents.patient_id AND pa.deleted_at IS NULL
		)
	);
