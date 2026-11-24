-- Anexos clínicos (Fase 4B-1): endurecimentos da revisão independente (0041 e 0042 já estão
-- aplicadas, por isso é migração nova).
--
-- 1. LOG: a política da 0041 só amarrava o anexo à visibilidade, não ao que de fato aconteceu: um autor
--    podia registrar "enviou"/"removeu" de um anexo seu sem tê-lo feito, e o admin (que nunca anexa)
--    podia registrar envio e remoção em nome próprio. Agora:
--      - `upload_attachment` só por profissional e só de anexo cujo `created_by` é ele;
--      - `remove_attachment` só por profissional e só de anexo cujo `removed_by` é ele (o gatilho
--        carimba `removed_by` na remoção, e o log é gravado na mesma transação);
--      - `read_attachment` continua para admin e profissional.
-- 2. STORAGE: o INSERT em `storage.objects` passa a exigir `owner_id` = o próprio login. O "órfão" (envio
--    ainda sem linha) é do dono do envio, e as políticas de leitura e de apagar do órfão confiam em
--    `owner_id`; sem esta conferência um envio com dono de outra pessoa ou vazio ficaria ilegível e
--    impossível de desfazer. (O Storage grava `owner_id` a partir do `sub` do JWT.)
-- 3. BUCKET: se um bucket com este id já existisse (por exemplo público), a 0042 o manteria como estava
--    (`ON CONFLICT DO NOTHING`). Aqui ele é FORÇADO a privado, 4 MiB e só os 4 tipos.
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
				WHERE a.id = clinical_access_log.attachment_id
					AND a.patient_id = clinical_access_log.patient_id
					AND (
						clinical_access_log.action::text = 'read_attachment'
						OR (
							clinical_access_log.role = 'professional'
							AND (
								(clinical_access_log.action::text = 'upload_attachment' AND a.created_by = (SELECT auth.uid()))
								OR (clinical_access_log.action::text = 'remove_attachment' AND a.removed_by = (SELECT auth.uid()))
							)
						)
					)
			)
		)
	);--> statement-breakpoint

DROP POLICY clinical_attachments_objects_insert ON storage.objects;--> statement-breakpoint
CREATE POLICY clinical_attachments_objects_insert ON storage.objects
	FOR INSERT TO authenticated
	WITH CHECK (
		bucket_id = 'clinical-attachments'
		AND (SELECT app.current_app_role()) = 'professional'
		AND owner_id = (SELECT auth.uid())::text
		AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.profile_id = (SELECT auth.uid()) AND pr.deleted_at IS NULL AND pr.active
		)
	);--> statement-breakpoint

UPDATE storage.buckets
SET public = false,
	file_size_limit = 4194304,
	allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
WHERE id = 'clinical-attachments';
