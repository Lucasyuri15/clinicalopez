ALTER TYPE "public"."clinical_access_action" ADD VALUE 'upload_attachment';--> statement-breakpoint
ALTER TYPE "public"."clinical_access_action" ADD VALUE 'read_attachment';--> statement-breakpoint
ALTER TYPE "public"."clinical_access_action" ADD VALUE 'remove_attachment';--> statement-breakpoint
CREATE TABLE "clinical_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"appointment_id" uuid,
	"storage_path" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_by" uuid DEFAULT auth.uid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "clinical_attachments_storage_path_uq" UNIQUE("storage_path"),
	CONSTRAINT "clinical_attachments_storage_path_check" CHECK ("clinical_attachments"."storage_path" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "clinical_attachments_name_check" CHECK (char_length("clinical_attachments"."original_name") between 1 and 120 and "clinical_attachments"."original_name" ~ '\S' and "clinical_attachments"."original_name" !~ '[\x01-\x1f\x7f]'),
	CONSTRAINT "clinical_attachments_type_check" CHECK ("clinical_attachments"."content_type" in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "clinical_attachments_size_check" CHECK ("clinical_attachments"."size_bytes" between 1 and 4194304),
	CONSTRAINT "clinical_attachments_sha256_check" CHECK ("clinical_attachments"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "clinical_attachments_removed_check" CHECK (("clinical_attachments"."removed_at" is null) = ("clinical_attachments"."removed_by" is null))
);
--> statement-breakpoint
ALTER TABLE "clinical_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clinical_access_log" DROP CONSTRAINT "clinical_access_log_note_check";--> statement-breakpoint
ALTER TABLE "clinical_access_log" ADD COLUMN "attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "clinical_attachments" ADD CONSTRAINT "clinical_attachments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_attachments" ADD CONSTRAINT "clinical_attachments_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_attachments" ADD CONSTRAINT "clinical_attachments_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_attachments" ADD CONSTRAINT "clinical_attachments_removed_by_profiles_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_attachments" ADD CONSTRAINT "clinical_attachments_appointment_fk" FOREIGN KEY ("appointment_id","patient_id","professional_id") REFERENCES "public"."appointments"("id","patient_id","professional_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_attachments_patient_idx" ON "clinical_attachments" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "clinical_attachments_professional_idx" ON "clinical_attachments" USING btree ("professional_id");--> statement-breakpoint
ALTER TABLE "clinical_access_log" ADD CONSTRAINT "clinical_access_log_attachment_id_clinical_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."clinical_attachments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_access_log" ADD CONSTRAINT "clinical_access_log_target_check" CHECK (("clinical_access_log"."action"::text = 'read_history' and "clinical_access_log"."note_id" is null and "clinical_access_log"."attachment_id" is null)
        or ("clinical_access_log"."action"::text in ('read_note', 'create_note', 'update_draft', 'finalize', 'add_addendum') and "clinical_access_log"."note_id" is not null and "clinical_access_log"."attachment_id" is null)
        or ("clinical_access_log"."action"::text in ('upload_attachment', 'read_attachment', 'remove_attachment') and "clinical_access_log"."attachment_id" is not null and "clinical_access_log"."note_id" is null));