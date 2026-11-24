-- Prontuário (Fase 4A): correção da política de INSERT do log de acesso, achada na revisão
-- independente (a 0036 já está aplicada, por isso é migração nova).
--
-- Defeito: a política exigia que o paciente fosse VISÍVEL a quem registra. O profissional só enxerga
-- o paciente enquanto está vinculado a ele e o cadastro não foi removido, e a recepção pode
-- desvincular ou remover. Já a evolução continua legível pelo AUTOR (a leitura é pelo autor, nunca
-- pelo vínculo). Resultado: o autor ainda lia a própria evolução, mas não conseguia registrar a
-- leitura; o app teria de recusar a leitura (o autor perde o acesso) ou ler sem log.
-- Correção: vale o paciente visível OU uma evolução desse paciente que a pessoa enxerga. Continua
-- barrado registrar um paciente sem relação nenhuma com quem registra.
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
		)
		AND (
			note_id IS NULL
			OR EXISTS (
				SELECT 1 FROM public.clinical_notes AS n
				WHERE n.id = clinical_access_log.note_id AND n.patient_id = clinical_access_log.patient_id
			)
		)
	);
