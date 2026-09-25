CREATE TABLE "agent_wallets" (
	"wallet" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"secret_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_wallet" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_agent_wallet_agent_wallets_wallet_fk" FOREIGN KEY ("agent_wallet") REFERENCES "public"."agent_wallets"("wallet") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_wallets_owner_idx" ON "agent_wallets" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "api_keys_agent_idx" ON "api_keys" USING btree ("agent_wallet");--> statement-breakpoint
CREATE INDEX "api_keys_owner_idx" ON "api_keys" USING btree ("owner");