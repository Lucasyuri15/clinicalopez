CREATE TYPE "public"."specialty" AS ENUM('physiotherapy', 'dentistry', 'psychology');--> statement-breakpoint
CREATE TABLE "insurances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "insurances_name_check" CHECK (char_length(btrim("insurances"."name")) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "insurances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "service_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"insurance_id" uuid,
	"price_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "service_prices_price_check" CHECK ("service_prices"."price_cents" between 0 and 10000000)
);
--> statement-breakpoint
ALTER TABLE "service_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"specialty" "specialty" NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "services_name_check" CHECK (char_length(btrim("services"."name")) between 1 and 120),
	CONSTRAINT "services_duration_check" CHECK ("services"."duration_minutes" between 5 and 480)
);
--> statement-breakpoint
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_insurance_id_insurances_id_fk" FOREIGN KEY ("insurance_id") REFERENCES "public"."insurances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "insurances_name_uq" ON "insurances" USING btree (lower("name")) WHERE "insurances"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "service_prices_particular_uq" ON "service_prices" USING btree ("service_id") WHERE "service_prices"."insurance_id" is null and "service_prices"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "service_prices_insurance_uq" ON "service_prices" USING btree ("service_id","insurance_id") WHERE "service_prices"."insurance_id" is not null and "service_prices"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "service_prices_insurance_idx" ON "service_prices" USING btree ("insurance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "services_specialty_name_uq" ON "services" USING btree ("specialty",lower("name")) WHERE "services"."deleted_at" is null;