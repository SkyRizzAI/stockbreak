CREATE TABLE "agent_autopilot" (
	"agent_wallet" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"interval_minutes" integer DEFAULT 30 NOT NULL,
	"strategy" text DEFAULT '' NOT NULL,
	"indexes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_requested" boolean DEFAULT false NOT NULL,
	"last_manual_run_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_wallet" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_status" (
	"name" text PRIMARY KEY NOT NULL,
	"info" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_autopilot" ADD CONSTRAINT "agent_autopilot_agent_wallet_agent_wallets_wallet_fk" FOREIGN KEY ("agent_wallet") REFERENCES "public"."agent_wallets"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_wallet_agent_wallets_wallet_fk" FOREIGN KEY ("agent_wallet") REFERENCES "public"."agent_wallets"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_autopilot_due_idx" ON "agent_autopilot" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_wallet","started_at");