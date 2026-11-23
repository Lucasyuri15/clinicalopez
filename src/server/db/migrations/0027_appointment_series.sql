CREATE TABLE "appointment_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"specialty" "specialty" NOT NULL,
	"created_by" uuid DEFAULT auth.uid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_series_identity_uq" UNIQUE("id","professional_id","patient_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "appointment_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_professional_fk" FOREIGN KEY ("professional_id","specialty") REFERENCES "public"."professionals"("id","specialty") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_service_fk" FOREIGN KEY ("service_id","specialty") REFERENCES "public"."services"("id","specialty") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointment_series_patient_idx" ON "appointment_series" USING btree ("patient_id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_series_fk" FOREIGN KEY ("series_id","professional_id","patient_id","service_id") REFERENCES "public"."appointment_series"("id","professional_id","patient_id","service_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_series_idx" ON "appointments" USING btree ("series_id","starts_at");