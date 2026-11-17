CREATE TABLE "professional_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "professional_time_off_period_check" CHECK ("professional_time_off"."starts_at" < "professional_time_off"."ends_at"),
	CONSTRAINT "professional_time_off_max_period_check" CHECK ("professional_time_off"."ends_at" - "professional_time_off"."starts_at" <= interval '366 days'),
	CONSTRAINT "professional_time_off_reason_check" CHECK ("professional_time_off"."reason" is null or (char_length("professional_time_off"."reason") between 1 and 120 and "professional_time_off"."reason" ~ '^\S(.*\S)?$'))
);
--> statement-breakpoint
ALTER TABLE "professional_time_off" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "professional_work_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"professional_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "professional_work_hours_weekday_check" CHECK ("professional_work_hours"."weekday" between 0 and 6),
	CONSTRAINT "professional_work_hours_range_check" CHECK ("professional_work_hours"."start_minute" between 0 and 1435 and "professional_work_hours"."end_minute" between 5 and 1440 and "professional_work_hours"."start_minute" < "professional_work_hours"."end_minute" and "professional_work_hours"."start_minute" % 5 = 0 and "professional_work_hours"."end_minute" % 5 = 0)
);
--> statement-breakpoint
ALTER TABLE "professional_work_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "professional_time_off" ADD CONSTRAINT "professional_time_off_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_work_hours" ADD CONSTRAINT "professional_work_hours_professional_id_professionals_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."professionals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "professional_time_off_professional_idx" ON "professional_time_off" USING btree ("professional_id","starts_at");--> statement-breakpoint
CREATE INDEX "professional_work_hours_professional_idx" ON "professional_work_hours" USING btree ("professional_id","weekday","start_minute");