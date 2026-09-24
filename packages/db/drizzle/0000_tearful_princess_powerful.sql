CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "badges" (
	"wallet" text NOT NULL,
	"badge" text NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badges_wallet_badge_pk" PRIMARY KEY("wallet","badge")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"signature" text NOT NULL,
	"ix_index" integer NOT NULL,
	"type" text NOT NULL,
	"index" text,
	"wallet" text,
	"slot" bigint NOT NULL,
	"data" jsonb NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	CONSTRAINT "events_signature_ix_index_pk" PRIMARY KEY("signature","ix_index")
);
--> statement-breakpoint
CREATE TABLE "faucet_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"cluster" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_snapshots" (
	"index" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"nav_micro_usd" bigint NOT NULL,
	"supply" bigint NOT NULL,
	"share_price_micro_usd" bigint NOT NULL,
	"weights" jsonb NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	CONSTRAINT "index_snapshots_index_ts_pk" PRIMARY KEY("index","ts")
);
--> statement-breakpoint
CREATE TABLE "indexer_state" (
	"program" text PRIMARY KEY NOT NULL,
	"last_signature" text,
	"last_slot" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexes" (
	"pubkey" text PRIMARY KEY NOT NULL,
	"creator" text NOT NULL,
	"index_id" bigint NOT NULL,
	"share_mint" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"uri" text DEFAULT '' NOT NULL,
	"description" text,
	"thesis" text,
	"parent" text,
	"follows_parent" boolean DEFAULT false NOT NULL,
	"assets" jsonb NOT NULL,
	"fees" jsonb NOT NULL,
	"strategy" jsonb NOT NULL,
	"managers" jsonb NOT NULL,
	"pending_update" jsonb,
	"paused" boolean DEFAULT false NOT NULL,
	"lookup_table" text,
	"is_agent_index" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"wallet" text NOT NULL,
	"index" text NOT NULL,
	"shares" bigint NOT NULL,
	"cost_basis_micro_usd" bigint NOT NULL,
	"first_joined_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "positions_wallet_index_pk" PRIMARY KEY("wallet","index")
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"symbol" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"price_micro_usd" bigint NOT NULL,
	"source" text NOT NULL,
	"synthetic" boolean DEFAULT false NOT NULL,
	CONSTRAINT "prices_symbol_ts_pk" PRIMARY KEY("symbol","ts")
);
--> statement-breakpoint
CREATE TABLE "sign_intents" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb NOT NULL,
	"wallet" text,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"signatures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_follows" (
	"follower" text NOT NULL,
	"followee" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_follows_follower_followee_pk" PRIMARY KEY("follower","followee")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"wallet" text PRIMARY KEY NOT NULL,
	"handle" text,
	"avatar_seed" text NOT NULL,
	"bio" text,
	"is_agent" boolean DEFAULT false NOT NULL,
	"agent_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "xp_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_ledger_unique" UNIQUE("wallet","reason","ref")
);
--> statement-breakpoint
CREATE INDEX "events_index_ts_idx" ON "events" USING btree ("index","ts");--> statement-breakpoint
CREATE INDEX "events_wallet_idx" ON "events" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "faucet_claims_wallet_idx" ON "faucet_claims" USING btree ("wallet","kind","created_at");--> statement-breakpoint
CREATE INDEX "indexes_creator_idx" ON "indexes" USING btree ("creator");--> statement-breakpoint
CREATE INDEX "indexes_parent_idx" ON "indexes" USING btree ("parent");--> statement-breakpoint
CREATE INDEX "positions_index_idx" ON "positions" USING btree ("index");--> statement-breakpoint
CREATE INDEX "xp_wallet_idx" ON "xp_ledger" USING btree ("wallet");