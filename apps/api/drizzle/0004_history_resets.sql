CREATE TABLE "history_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"learner_id" uuid NOT NULL,
	"skill_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "history_resets" ADD CONSTRAINT "history_resets_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "history_resets_learner_idx" ON "history_resets" USING btree ("tenant_id","learner_id");