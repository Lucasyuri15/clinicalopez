-- Anexos clínicos (Fase 4B-1): o bucket privado e as políticas de `storage.objects`. O servidor fala
-- com o Storage com o JWT do usuário (nenhuma chave secret no app): quem decide é esta RLS, que
-- consulta `clinical_attachments` (cuja própria RLS é a do autor/admin, 0040).
--
-- Bucket `clinical-attachments`: PRIVADO, limite de 4 MiB e só PDF, JPEG, PNG e WebP (defesa em
-- profundidade: o app e o CHECK da tabela já conferem). O nome do objeto é só um UUID (sem dado
-- pessoal), igual a `clinical_attachments.storage_path`.
--
-- Quem LÊ um objeto (SELECT): quem lê a linha de `clinical_attachments` com aquele caminho (o autor e
--   o admin; a recepção e os outros profissionais não leem a linha), com uma exceção: o arquivo de um
--   anexo REMOVIDO só o admin lê. Além disso, o autor lê o PRÓPRIO envio ainda sem linha (órfão),
--   porque o Storage precisa enxergar o objeto para apagá-lo.
-- Quem ENVIA (INSERT): só o profissional ativo e não removido, para este bucket e com nome UUID.
-- Quem APAGA (DELETE): só o autor do órfão (envio sem linha: o app o desfaz quando o banco falha).
--   O arquivo de um anexo com linha NUNCA é apagado (remover é lógico).
-- UPDATE: nenhuma política (ninguém renomeia nem sobrescreve; o app nunca usa `upsert`).
-- aal2: RESTRICTIVE para tudo em `storage.objects` (a URL e a chave publishable são públicas).
-- Limite conhecido: um profissional com JWT aal2 poderia enviar objetos diretamente ao Storage sem
-- registrá-los; eles seguem ilegíveis para todos (sem linha) e limitados a 4 MiB e aos 4 tipos.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
	'clinical-attachments', 'clinical-attachments', false, 4194304,
	ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint

CREATE POLICY clinical_attachments_objects_select ON storage.objects
	FOR SELECT TO authenticated
	USING (
		bucket_id = 'clinical-attachments'
		AND EXISTS (
			SELECT 1 FROM public.clinical_attachments AS a
			WHERE a.storage_path = objects.name
				AND (a.removed_at IS NULL OR (SELECT app.current_app_role()) = 'admin')
		)
	);--> statement-breakpoint

CREATE POLICY clinical_attachments_objects_select_orphan ON storage.objects
	FOR SELECT TO authenticated
	USING (
		bucket_id = 'clinical-attachments'
		AND (SELECT app.current_app_role()) = 'professional'
		AND owner_id = (SELECT auth.uid())::text
		AND NOT EXISTS (SELECT 1 FROM public.clinical_attachments AS a WHERE a.storage_path = objects.name)
	);--> statement-breakpoint

CREATE POLICY clinical_attachments_objects_insert ON storage.objects
	FOR INSERT TO authenticated
	WITH CHECK (
		bucket_id = 'clinical-attachments'
		AND (SELECT app.current_app_role()) = 'professional'
		AND name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		AND EXISTS (
			SELECT 1 FROM public.professionals AS pr
			WHERE pr.profile_id = (SELECT auth.uid()) AND pr.deleted_at IS NULL AND pr.active
		)
	);--> statement-breakpoint

CREATE POLICY clinical_attachments_objects_delete_orphan ON storage.objects
	FOR DELETE TO authenticated
	USING (
		bucket_id = 'clinical-attachments'
		AND (SELECT app.current_app_role()) = 'professional'
		AND owner_id = (SELECT auth.uid())::text
		AND NOT EXISTS (SELECT 1 FROM public.clinical_attachments AS a WHERE a.storage_path = objects.name)
	);--> statement-breakpoint

CREATE POLICY storage_objects_require_aal2 ON storage.objects
	AS RESTRICTIVE FOR ALL TO authenticated
	USING (((SELECT auth.jwt()) ->> 'aal') = 'aal2')
	WITH CHECK (((SELECT auth.jwt()) ->> 'aal') = 'aal2');
