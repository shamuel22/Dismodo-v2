CREATE TYPE "public"."package_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."package_visibility" AS ENUM('private', 'public');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"label" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_prefix_unique" UNIQUE("prefix")
);
--> statement-breakpoint
CREATE TABLE "packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"experience_id" text NOT NULL,
	"version" text NOT NULL,
	"status" "package_status" DEFAULT 'draft' NOT NULL,
	"visibility" "package_visibility" DEFAULT 'private' NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"activity_revision" text NOT NULL,
	"evaluator_revision" text NOT NULL,
	"validation_summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attestation" jsonb
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "packages" ADD CONSTRAINT "packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_tenant_idx" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "packages_tenant_experience_version_uq" ON "packages" USING btree ("tenant_id","experience_id","version");--> statement-breakpoint
CREATE INDEX "packages_published_idx" ON "packages" USING btree ("status","visibility") WHERE "packages"."status" = 'published';