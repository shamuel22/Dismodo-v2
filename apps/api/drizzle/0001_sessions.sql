CREATE TYPE "public"."session_policy" AS ENUM('adaptive', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'paused', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "learners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"session_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"skill_key" text NOT NULL,
	"experience_ref" text NOT NULL,
	"engine_version" text NOT NULL,
	"phase" text NOT NULL,
	"identity" text NOT NULL,
	"context_id" text NOT NULL,
	"correct" boolean,
	"error_code" text,
	"alternative_codes" text[] NOT NULL,
	"hints_used" integer NOT NULL,
	"self_rating" text,
	"unfamiliar_reference" boolean NOT NULL,
	"interventions_before" text[] NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "observations_session_id_item_id_pk" PRIMARY KEY("session_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"actor" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"client_event_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_events_session_id_seq_pk" PRIMARY KEY("session_id","seq")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"experience_ref" text NOT NULL,
	"content_hash" text NOT NULL,
	"skill_key" text NOT NULL,
	"policy" "session_policy" NOT NULL,
	"seed" integer NOT NULL,
	"status" "session_status" DEFAULT 'active' NOT NULL,
	"phase" text NOT NULL,
	"last_seq" integer NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "learners" ADD CONSTRAINT "learners_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_package_id_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "learners_tenant_ref_uq" ON "learners" USING btree ("tenant_id","external_ref");--> statement-breakpoint
CREATE INDEX "observations_memory_idx" ON "observations" USING btree ("tenant_id","learner_id","skill_key");--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_client_id_uq" ON "session_events" USING btree ("session_id","client_event_id") WHERE "session_events"."client_event_id" is not null;--> statement-breakpoint
CREATE INDEX "sessions_tenant_learner_idx" ON "sessions" USING btree ("tenant_id","learner_id","skill_key");