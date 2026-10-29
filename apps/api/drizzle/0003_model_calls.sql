CREATE TABLE "model_calls" (
	"session_id" uuid NOT NULL,
	"event_seq" integer NOT NULL,
	"attempt" integer NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"tier" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"reasoning_tokens" integer,
	"error" text,
	"decision_source" text NOT NULL,
	"escalation_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "model_calls_session_id_event_seq_attempt_pk" PRIMARY KEY("session_id","event_seq","attempt")
);
--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_calls_tenant_idx" ON "model_calls" USING btree ("tenant_id","created_at");