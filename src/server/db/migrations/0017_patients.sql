CREATE TABLE "patient_private" (
	"patient_id" uuid PRIMARY KEY NOT NULL,
	"cpf" text,
	"no_cpf_reason" text,
	"cep" text,
	"street" text,
	"number" text,
	"complement" text,
	"district" text,
	"city" text,
	"state" text,
	"insurance_id" uuid,
	"insurance_card" text,
	"guardian_name" text,
	"guardian_relationship" text,
	"guardian_phone" text,
	"guardian_cpf" text,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_private_cpf_check" CHECK ("patient_private"."cpf" is null or "patient_private"."cpf" ~ '^[0-9]{11}$'),
	CONSTRAINT "patient_private_no_cpf_reason_check" CHECK ("patient_private"."no_cpf_reason" is null or (char_length("patient_private"."no_cpf_reason") between 1 and 200 and "patient_private"."no_cpf_reason" ~ '^\S(.*\S)?$' and "patient_private"."no_cpf_reason" !~ '[\x01-\x1f\x7f]')),
	CONSTRAINT "patient_private_cpf_or_reason_check" CHECK (("patient_private"."cpf" is not null) <> ("patient_private"."no_cpf_reason" is not null)),
	CONSTRAINT "patient_private_cep_check" CHECK ("patient_private"."cep" is null or "patient_private"."cep" ~ '^[0-9]{8}$'),
	CONSTRAINT "patient_private_street_check" CHECK ("patient_private"."street" is null or (char_length("patient_private"."street") between 1 and 120 and "patient_private"."street" ~ '^\S(.*\S)?$' and "patient_private"."street" !~ '[\x01-\x1f\x7f]')),
	CONSTRAINT "patient_private_number_check" CHECK ("patient_private"."number" is null or (char_length("patient_private"."number") between 1 and 20 and "patient_private"."number" ~ '^\S(.*\S)?$' and "patient_private"."number" !~ '[\x01-\x1f\x7f]')),
	CONSTRAINT "patient_private_complement_check" CHECK ("patient_private"."complement" is null or (char_length("patient_private"."complement") between 1 and 60 and "patient_private"."complement" ~ '^\S(.*\S)?$' and "patient_private"."complement" !~ '[\x01-\x1f\x7f]')),
	CONSTRAINT "patient_private_district_check" CHECK ("patient_private"."district" is null or (char_length("patient_private"."district") between 1 and 60 and "patient_private"."district" ~ '^\S(.*\S)?$' and "patient_private"."district" !~ '[\x01-\x1f\x7f]')),
	CONSTRAINT "patient_private_city_check" CHECK ("patient_private"."city" is null or (char_length("patient_private"."city") between 1 and 60 and "patient_private"."city" ~ '^\S(.*\S)?$' and "patient_private"."city" !~ '[\x01-\x1f\x7f]')),
	CONSTRAINT "patient_private_state_check" CHECK ("patient_private"."state" is null or "patient_private"."state" ~ '^[A-Z]{2}$'),
	CONSTRAINT "patient_private_card_check" CHECK ("patient_private"."insurance_card" is null or (char_length("patient_private"."insurance_card") between 1 and 40 and "patient_private"."insurance_card" ~ '^\S(.*\S)?$' and "patient_private"."insurance_card" !~ '[\x01-\x1f\x7f]')),
	CONSTRAINT "patient_private_card_insurance_check" CHECK ("patient_private"."insurance_card" is null or "patient_private"."insurance_id" is not null),
	CONSTRAINT "patient_private_guardian_name_check" CHECK ("patient_private"."guardian_name" is null or (char_length("patient_private"."guardian_name") between 1 and 120 and "patient_private"."guardian_name" ~ '^\S(.*\S)?$' and "patient_private"."guardian_name" !~ '[\x01-\x1f\x7f]')),
	CONSTRAINT "patient_private_guardian_relationship_check" CHECK ("patient_private"."guardian_relationship" is null or (char_length("patient_private"."guardian_relationship") between 1 and 40 and "patient_private"."guardian_relationship" ~ '^\S(.*\S)?$' and "patient_private"."guardian_relationship" !~ '[\x01-\x1f\x7f]')),
	CONSTRAINT "patient_private_guardian_phone_check" CHECK ("patient_private"."guardian_phone" is null or "patient_private"."guardian_phone" ~ '^[0-9]{10,11}$'),
	CONSTRAINT "patient_private_guardian_cpf_check" CHECK ("patient_private"."guardian_cpf" is null or "patient_private"."guardian_cpf" ~ '^[0-9]{11}$'),
	CONSTRAINT "patient_private_admin_notes_check" CHECK ("patient_private"."admin_notes" is null or (char_length("patient_private"."admin_notes") between 1 and 1000 and "patient_private"."admin_notes" ~ '^\S(.*\S)?$' and "patient_private"."admin_notes" !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]'))
);
--> statement-breakpoint
ALTER TABLE "patient_private" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "patient_professionals" (
	"patient_id" uuid NOT NULL,
	"professional_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_professionals_pk" PRIMARY KEY("patient_id","professional_id")
);
--> statement-breakpoint
ALTER TABLE "patient_professionals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"birth_date" date NOT NULL,
	"phone" text,
	"email" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "patients_name_check" CHECK (char_length("patients"."full_name") between 1 and 120 and "patients"."full_name" ~ '^\S(.*\S)?$' and "patients"."full_name" !~ '[\x01-\x1f\x7f]'),
	CONSTRAINT "patients_birth_date_check" CHECK ("patients"."birth_date" between date '1900-01-01' and current_date),
	CONSTRAINT "patients_phone_check" CHECK ("patients"."phone" is null or "patients"."phone" ~ '^[0-9]{10,11}$'),
	CONSTRAINT "patients_email_check" CHECK ("patients"."email" is null or (char_length("patients"."email") <= 254 and "patients"."email" ~ '^[^\s@]+@[^\s@]+$'))
);
--> statement-breakpoint
ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_private" ADD CONSTRAINT "patient_private_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_private" ADD CONSTRAINT "patient_private_insurance_id_insurances_id_fk" FOREIGN KEY ("insurance_id") REFERENCES "public"."insurances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_professionals" ADD CONSTRAINT "patient_professionals_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_professionals" ADD CONSTRAINT "patient_professionals_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patient_private_cpf_uq" ON "patient_private" USING btree ("cpf");--> statement-breakpoint
CREATE INDEX "patient_private_insurance_idx" ON "patient_private" USING btree ("insurance_id");--> statement-breakpoint
CREATE INDEX "patient_professionals_professional_idx" ON "patient_professionals" USING btree ("professional_id");--> statement-breakpoint
CREATE INDEX "patients_name_idx" ON "patients" USING btree (lower("full_name"));