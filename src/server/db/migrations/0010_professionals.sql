-- Os UNIQUE de profiles e services vêm PRIMEIRO (o drizzle-kit os gerou no fim): as FKs compostas
-- abaixo só podem referenciar colunas que já têm uma restrição única.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_role_uq" UNIQUE("id","role");--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_id_specialty_uq" UNIQUE("id","specialty");--> statement-breakpoint
CREATE TABLE "professional_services" (
	"professional_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"specialty" "specialty" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "professional_services_pk" PRIMARY KEY("professional_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "professional_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "professionals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"specialty" "specialty" NOT NULL,
	"registration" text,
	"phone" text,
	"email" text,
	"profile_id" uuid,
	"link_role" "user_role" DEFAULT 'professional' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "professionals_id_specialty_uq" UNIQUE("id","specialty"),
	CONSTRAINT "professionals_name_check" CHECK (char_length("professionals"."full_name") between 1 and 120 and "professionals"."full_name" ~ '^\S(.*\S)?$'),
	CONSTRAINT "professionals_registration_check" CHECK ("professionals"."registration" is null or (char_length("professionals"."registration") between 3 and 30 and "professionals"."registration" ~ '^\S(.*\S)?$')),
	CONSTRAINT "professionals_phone_check" CHECK ("professionals"."phone" is null or "professionals"."phone" ~ '^[0-9]{10,11}$'),
	CONSTRAINT "professionals_email_check" CHECK ("professionals"."email" is null or (char_length("professionals"."email") <= 254 and "professionals"."email" ~ '^[^\s@]+@[^\s@]+$')),
	CONSTRAINT "professionals_link_role_check" CHECK ("professionals"."link_role" = 'professional')
);
--> statement-breakpoint
ALTER TABLE "professionals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_professional_fk" FOREIGN KEY ("professional_id","specialty") REFERENCES "public"."professionals"("id","specialty") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_service_fk" FOREIGN KEY ("service_id","specialty") REFERENCES "public"."services"("id","specialty") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_profile_fk" FOREIGN KEY ("profile_id","link_role") REFERENCES "public"."profiles"("id","role") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "professional_services_service_idx" ON "professional_services" USING btree ("service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "professionals_profile_uq" ON "professionals" USING btree ("profile_id") WHERE "professionals"."profile_id" is not null and "professionals"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "professionals_specialty_name_uq" ON "professionals" USING btree ("specialty",lower("full_name")) WHERE "professionals"."deleted_at" is null;
