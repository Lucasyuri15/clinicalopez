CREATE TABLE "patient_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"given_by" text NOT NULL,
	"method" text NOT NULL,
	"occurred_on" date NOT NULL,
	"note" text,
	"registered_by" uuid DEFAULT auth.uid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_consents_kind_check" CHECK ("patient_consents"."kind" in ('data_processing', 'whatsapp')),
	CONSTRAINT "patient_consents_given_by_check" CHECK ("patient_consents"."given_by" in ('patient', 'guardian')),
	CONSTRAINT "patient_consents_method_check" CHECK ("patient_consents"."method" in ('signed_paper', 'verbal', 'digital')),
	CONSTRAINT "patient_consents_occurred_on_check" CHECK ("patient_consents"."occurred_on" between date '1900-01-01' and date '2100-12-31'),
	CONSTRAINT "patient_consents_note_check" CHECK ("patient_consents"."note" is null or (char_length("patient_consents"."note") between 1 and 300 and "patient_consents"."note" ~ '^\S(.*\S)?$' and "patient_consents"."note" !~ '[\x01-\x1f\x7f]'))
);
--> statement-breakpoint
ALTER TABLE "patient_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_registered_by_profiles_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_consents_patient_idx" ON "patient_consents" USING btree ("patient_id","occurred_on","created_at");