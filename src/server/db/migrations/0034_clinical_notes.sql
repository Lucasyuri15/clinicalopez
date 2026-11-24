ALTER TABLE "appointments" ADD CONSTRAINT "appointments_identity_uq" UNIQUE("id","patient_id","professional_id");--> statement-breakpoint
CREATE TYPE "public"."clinical_access_action" AS ENUM('read_note', 'read_history', 'create_note', 'update_draft', 'finalize', 'add_addendum');--> statement-breakpoint
CREATE TYPE "public"."clinical_note_status" AS ENUM('draft', 'finalized');--> statement-breakpoint
CREATE TABLE "clinical_access_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "clinical_access_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid DEFAULT auth.uid() NOT NULL,
	"role" "user_role" DEFAULT app.current_app_role() NOT NULL,
	"action" "clinical_access_action" NOT NULL,
	"patient_id" uuid NOT NULL,
	"note_id" uuid
);
--> statement-breakpoint
ALTER TABLE "clinical_access_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clinical_note_addenda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid DEFAULT auth.uid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_note_addenda_body_check" CHECK (char_length("clinical_note_addenda"."body") between 1 and 20000 and "clinical_note_addenda"."body" ~ '\S' and "clinical_note_addenda"."body" !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')
);
--> statement-breakpoint
ALTER TABLE "clinical_note_addenda" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clinical_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" "clinical_note_status" DEFAULT 'draft' NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_notes_appointment_uq" UNIQUE("appointment_id"),
	CONSTRAINT "clinical_notes_body_check" CHECK (char_length("clinical_notes"."body") between 1 and 20000 and "clinical_notes"."body" ~ '\S' and "clinical_notes"."body" !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'),
	CONSTRAINT "clinical_notes_finalized_check" CHECK (("clinical_notes"."status" = 'finalized') = ("clinical_notes"."finalized_at" is not null)),
	CONSTRAINT "clinical_notes_finalized_by_check" CHECK (("clinical_notes"."finalized_at" is null) = ("clinical_notes"."finalized_by" is null))
);
--> statement-breakpoint
ALTER TABLE "clinical_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clinical_access_log" ADD CONSTRAINT "clinical_access_log_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_access_log" ADD CONSTRAINT "clinical_access_log_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_access_log" ADD CONSTRAINT "clinical_access_log_note_id_clinical_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."clinical_notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_note_addenda" ADD CONSTRAINT "clinical_note_addenda_note_id_clinical_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."clinical_notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_note_addenda" ADD CONSTRAINT "clinical_note_addenda_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_finalized_by_profiles_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_appointment_fk" FOREIGN KEY ("appointment_id","patient_id","professional_id") REFERENCES "public"."appointments"("id","patient_id","professional_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clinical_access_log_patient_idx" ON "clinical_access_log" USING btree ("patient_id","at");--> statement-breakpoint
CREATE INDEX "clinical_access_log_at_idx" ON "clinical_access_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "clinical_note_addenda_note_idx" ON "clinical_note_addenda" USING btree ("note_id","created_at");--> statement-breakpoint
CREATE INDEX "clinical_notes_patient_idx" ON "clinical_notes" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "clinical_notes_professional_idx" ON "clinical_notes" USING btree ("professional_id");
