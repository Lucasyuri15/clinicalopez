CREATE TABLE "appointment_prices" (
	"appointment_id" uuid PRIMARY KEY NOT NULL,
	"price_cents" integer NOT NULL,
	"insurance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_prices_price_check" CHECK ("appointment_prices"."price_cents" between 0 and 10000000)
);
--> statement-breakpoint
ALTER TABLE "appointment_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"specialty" "specialty" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"cancel_reason" text,
	"created_by" uuid DEFAULT auth.uid() NOT NULL,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_status_check" CHECK ("appointments"."status" in ('scheduled', 'confirmed', 'done', 'no_show', 'cancelled')),
	CONSTRAINT "appointments_range_check" CHECK ("appointments"."starts_at" < "appointments"."ends_at"),
	CONSTRAINT "appointments_duration_check" CHECK ("appointments"."ends_at" - "appointments"."starts_at" between interval '5 minutes' and interval '8 hours'),
	CONSTRAINT "appointments_step_check" CHECK (mod(extract(epoch from "appointments"."starts_at"), 300) = 0 and mod(extract(epoch from "appointments"."ends_at"), 300) = 0),
	CONSTRAINT "appointments_bounds_check" CHECK ("appointments"."starts_at" >= timestamptz '2000-01-01 00:00:00+00' and "appointments"."ends_at" < timestamptz '2101-01-01 00:00:00+00'),
	CONSTRAINT "appointments_cancel_reason_check" CHECK (("appointments"."status" = 'cancelled') = ("appointments"."cancel_reason" is not null)),
	CONSTRAINT "appointments_cancel_reason_format_check" CHECK ("appointments"."cancel_reason" is null or (char_length("appointments"."cancel_reason") between 1 and 200 and "appointments"."cancel_reason" ~ '^\S(.*\S)?$' and "appointments"."cancel_reason" !~ '[\x01-\x1f\x7f]'))
);
--> statement-breakpoint
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointment_prices" ADD CONSTRAINT "appointment_prices_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_prices" ADD CONSTRAINT "appointment_prices_insurance_id_insurances_id_fk" FOREIGN KEY ("insurance_id") REFERENCES "public"."insurances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_status_changed_by_profiles_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_fk" FOREIGN KEY ("professional_id","specialty") REFERENCES "public"."professionals"("id","specialty") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_fk" FOREIGN KEY ("service_id","specialty") REFERENCES "public"."services"("id","specialty") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_prices_insurance_idx" ON "appointment_prices" USING btree ("insurance_id");--> statement-breakpoint
CREATE INDEX "appointments_starts_idx" ON "appointments" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_idx" ON "appointments" USING btree ("patient_id","starts_at");