ALTER TABLE "insurances" DROP CONSTRAINT "insurances_name_check";--> statement-breakpoint
ALTER TABLE "services" DROP CONSTRAINT "services_name_check";--> statement-breakpoint
ALTER TABLE "insurances" ADD CONSTRAINT "insurances_name_check" CHECK (char_length("insurances"."name") between 1 and 120 and "insurances"."name" ~ '^\S(.*\S)?$');--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_name_check" CHECK (char_length("services"."name") between 1 and 120 and "services"."name" ~ '^\S(.*\S)?$');