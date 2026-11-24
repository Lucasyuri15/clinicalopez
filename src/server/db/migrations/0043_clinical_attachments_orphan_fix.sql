-- Anexos clínicos (Fase 4B-1): correção das políticas de "órfão" da 0042 (já aplicada, por isso é
-- migração nova), achada pelo teste do profissional INATIVO.
--
-- Defeito: "órfão" era `NOT EXISTS (SELECT ... FROM clinical_attachments ...)` DENTRO da política, e
-- essa subconsulta passa pela RLS de quem lê. Quando a linha do anexo fica invisível ao autor
-- (cadastro dele inativo ou removido, por exemplo), o arquivo parecia "sem linha" e o autor voltava a
-- lê-lo (e poderia apagá-lo) como se fosse um envio ainda não registrado.
-- Correção: a pergunta "este caminho já tem linha?" é feita por uma função SECURITY DEFINER, que NÃO
-- depende do que a RLS esconde, e o órfão só vale para o profissional ATIVO e dono do envio.
CREATE OR REPLACE FUNCTION app.clinical_attachment_path_registered(p_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
	SELECT EXISTS (SELECT 1 FROM public.clinical_attachments AS a WHERE a.storage_path = p_name)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.clinical_attachment_path_registered(text) FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.clinical_attachment_path_registered(text) TO authenticated;--> statement-breakpoint

DROP POLICY clinical_attachments_objects_select_orphan ON storage.objects;--> statement-breakpoint
CREATE POLICY clinical_attachments_objects_select_orphan ON storage.objects
	FOR SELECT TO authenticated
	USING (
		bucket_id = 'clinical-attachments'
		AND (SELECT app.current_app_role()) = 'professional'
		AND owner_id = (SELECT auth.uid())::text
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.profile_id = (SELECT auth.uid()) AND pr.deleted_at IS NULL AND pr.active
		)
		AND NOT (SELECT app.clinical_attachment_path_registered(objects.name))
	);--> statement-breakpoint

DROP POLICY clinical_attachments_objects_delete_orphan ON storage.objects;--> statement-breakpoint
CREATE POLICY clinical_attachments_objects_delete_orphan ON storage.objects
	FOR DELETE TO authenticated
	USING (
		bucket_id = 'clinical-attachments'
		AND (SELECT app.current_app_role()) = 'professional'
		AND owner_id = (SELECT auth.uid())::text
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.profile_id = (SELECT auth.uid()) AND pr.deleted_at IS NULL AND pr.active
		)
		AND NOT (SELECT app.clinical_attachment_path_registered(objects.name))
	);
