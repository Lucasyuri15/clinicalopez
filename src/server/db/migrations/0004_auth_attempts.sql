CREATE TABLE "auth_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"ip" text NOT NULL,
	"subject_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_attempts_kind_check" CHECK ("auth_attempts"."kind" in ('login', 'mfa')),
	CONSTRAINT "auth_attempts_ip_check" CHECK (char_length("auth_attempts"."ip") between 1 and 64),
	CONSTRAINT "auth_attempts_subject_check" CHECK ("auth_attempts"."subject_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "auth_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "auth_attempts_ip_idx" ON "auth_attempts" USING btree ("kind","ip","created_at");--> statement-breakpoint
CREATE INDEX "auth_attempts_pair_idx" ON "auth_attempts" USING btree ("kind","subject_hash","ip","created_at");--> statement-breakpoint
CREATE INDEX "auth_attempts_created_idx" ON "auth_attempts" USING btree ("created_at");