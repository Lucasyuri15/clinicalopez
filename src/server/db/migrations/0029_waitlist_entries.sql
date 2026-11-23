CREATE TYPE "public"."waitlist_status" AS ENUM('waiting', 'fulfilled', 'removed');--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"professional_id" uuid,
	"specialty" "specialty" NOT NULL,
	"weekdays" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"start_minute" smallint,
	"end_minute" smallint,
	"note" text,
	"status" "waitlist_status" DEFAULT 'waiting' NOT NULL,
	"appointment_id" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_by" uuid DEFAULT auth.uid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_entries_weekdays_check" CHECK (coalesce(array_ndims("waitlist_entries"."weekdays"), 1) = 1 and cardinality("waitlist_entries"."weekdays") <= 7 and "waitlist_entries"."weekdays" <@ array[0,1,2,3,4,5,6]::smallint[]),
	CONSTRAINT "waitlist_entries_window_check" CHECK (("waitlist_entries"."start_minute" is null and "waitlist_entries"."end_minute" is null) or ("waitlist_entries"."start_minute" is not null and "waitlist_entries"."end_minute" is not null and "waitlist_entries"."start_minute" between 0 and 1435 and "waitlist_entries"."end_minute" between 5 and 1440 and "waitlist_entries"."start_minute" < "waitlist_entries"."end_minute" and "waitlist_entries"."start_minute" % 5 = 0 and "waitlist_entries"."end_minute" % 5 = 0)),
	CONSTRAINT "waitlist_entries_note_check" CHECK ("waitlist_entries"."note" is null or (char_length("waitlist_entries"."note") between 1 and 200 and "waitlist_entries"."note" ~ '^\S(.*\S)?$' and "waitlist_entries"."note" !~ '[\x01-\x1f\x7f]')),
	CONSTRAINT "waitlist_entries_fulfilled_check" CHECK (("waitlist_entries"."status" = 'fulfilled') = ("waitlist_entries"."appointment_id" is not null)),
	CONSTRAINT "waitlist_entries_closed_check" CHECK (("waitlist_entries"."status" = 'waiting') = ("waitlist_entries"."closed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_closed_by_profiles_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_service_fk" FOREIGN KEY ("service_id","specialty") REFERENCES "public"."services"("id","specialty") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_professional_fk" FOREIGN KEY ("professional_id","specialty") REFERENCES "public"."professionals"("id","specialty") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_open_uq" ON "waitlist_entries" USING btree ("patient_id","service_id",coalesce("professional_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "waitlist_entries"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "waitlist_entries_status_idx" ON "waitlist_entries" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "waitlist_entries_patient_idx" ON "waitlist_entries" USING btree ("patient_id");