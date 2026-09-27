CREATE TABLE `agent_autopilot` (
	`agent_wallet` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`interval_minutes` integer DEFAULT 30 NOT NULL,
	`strategy` text DEFAULT '' NOT NULL,
	`indexes` text DEFAULT '[]' NOT NULL,
	`run_requested` integer DEFAULT false NOT NULL,
	`last_manual_run_at` integer,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer,
	FOREIGN KEY (`agent_wallet`) REFERENCES `agent_wallets`(`wallet`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_autopilot_due_idx` ON `agent_autopilot` (`next_run_at`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_wallet` text NOT NULL,
	`started_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL,
	`finished_at` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`actions` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`agent_wallet`) REFERENCES `agent_wallets`(`wallet`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_runs_agent_idx` ON `agent_runs` (`agent_wallet`,`started_at`);--> statement-breakpoint
CREATE TABLE `agent_wallets` (
	`wallet` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`secret_enc` text NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_wallets_owner_idx` ON `agent_wallets` (`owner`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_wallet` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`agent_wallet`) REFERENCES `agent_wallets`(`wallet`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_agent_idx` ON `api_keys` (`agent_wallet`);--> statement-breakpoint
CREATE INDEX `api_keys_owner_idx` ON `api_keys` (`owner`);--> statement-breakpoint
CREATE TABLE `auth_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_wallet_idx` ON `auth_sessions` (`wallet`);--> statement-breakpoint
CREATE TABLE `badges` (
	`wallet` text NOT NULL,
	`badge` text NOT NULL,
	`awarded_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL,
	PRIMARY KEY(`wallet`, `badge`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`signature` text NOT NULL,
	`ix_index` integer NOT NULL,
	`type` text NOT NULL,
	`index` text,
	`wallet` text,
	`slot` integer NOT NULL,
	`data` text NOT NULL,
	`ts` integer NOT NULL,
	PRIMARY KEY(`signature`, `ix_index`)
);
--> statement-breakpoint
CREATE INDEX `events_index_ts_idx` ON `events` (`index`,`ts`);--> statement-breakpoint
CREATE INDEX `events_wallet_idx` ON `events` (`wallet`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`);--> statement-breakpoint
CREATE TABLE `faucet_claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wallet` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`cluster` text NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `faucet_claims_wallet_idx` ON `faucet_claims` (`wallet`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `index_snapshots` (
	`index` text NOT NULL,
	`ts` integer NOT NULL,
	`nav_micro_usd` integer NOT NULL,
	`supply` integer NOT NULL,
	`share_price_micro_usd` integer NOT NULL,
	`weights` text NOT NULL,
	`synthetic` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`index`, `ts`)
);
--> statement-breakpoint
CREATE TABLE `indexer_state` (
	`program` text PRIMARY KEY NOT NULL,
	`last_signature` text,
	`last_slot` integer,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `indexes` (
	`pubkey` text PRIMARY KEY NOT NULL,
	`creator` text NOT NULL,
	`index_id` integer NOT NULL,
	`share_mint` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`uri` text DEFAULT '' NOT NULL,
	`description` text,
	`thesis` text,
	`parent` text,
	`follows_parent` integer DEFAULT false NOT NULL,
	`assets` text NOT NULL,
	`fees` text NOT NULL,
	`strategy` text NOT NULL,
	`managers` text NOT NULL,
	`pending_update` text,
	`paused` integer DEFAULT false NOT NULL,
	`lookup_table` text,
	`is_agent_index` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `indexes_creator_idx` ON `indexes` (`creator`);--> statement-breakpoint
CREATE INDEX `indexes_parent_idx` ON `indexes` (`parent`);--> statement-breakpoint
CREATE TABLE `positions` (
	`wallet` text NOT NULL,
	`index` text NOT NULL,
	`shares` integer NOT NULL,
	`cost_basis_micro_usd` integer NOT NULL,
	`first_joined_at` integer NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL,
	PRIMARY KEY(`wallet`, `index`)
);
--> statement-breakpoint
CREATE INDEX `positions_index_idx` ON `positions` (`index`);--> statement-breakpoint
CREATE TABLE `post_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `post_comments_post_idx` ON `post_comments` (`post_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `post_comments_author_idx` ON `post_comments` (`author`,`created_at`);--> statement-breakpoint
CREATE TABLE `post_likes` (
	`post_id` integer NOT NULL,
	`wallet` text NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL,
	PRIMARY KEY(`post_id`, `wallet`)
);
--> statement-breakpoint
CREATE INDEX `post_likes_wallet_idx` ON `post_likes` (`wallet`,`created_at`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`author` text NOT NULL,
	`index` text,
	`card_variant` text,
	`body` text NOT NULL,
	`like_count` integer DEFAULT 0 NOT NULL,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `posts_created_idx` ON `posts` (`created_at`);--> statement-breakpoint
CREATE INDEX `posts_author_idx` ON `posts` (`author`,`created_at`);--> statement-breakpoint
CREATE INDEX `posts_index_idx` ON `posts` (`index`,`created_at`);--> statement-breakpoint
CREATE TABLE `prices` (
	`symbol` text NOT NULL,
	`ts` integer NOT NULL,
	`price_micro_usd` integer NOT NULL,
	`source` text NOT NULL,
	`synthetic` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`symbol`, `ts`)
);
--> statement-breakpoint
CREATE TABLE `sign_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`params` text NOT NULL,
	`wallet` text,
	`created_by` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`signatures` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `social_follows` (
	`follower` text NOT NULL,
	`followee` text NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL,
	PRIMARY KEY(`follower`, `followee`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`wallet` text PRIMARY KEY NOT NULL,
	`handle` text,
	`avatar_seed` text NOT NULL,
	`bio` text,
	`is_agent` integer DEFAULT false NOT NULL,
	`agent_name` text,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_handle_unique` ON `users` (`handle`);--> statement-breakpoint
CREATE TABLE `worker_status` (
	`name` text PRIMARY KEY NOT NULL,
	`info` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `xp_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`wallet` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`ref` text NOT NULL,
	`created_at` integer DEFAULT (cast(strftime('%s', 'now') as integer) * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `xp_wallet_idx` ON `xp_ledger` (`wallet`);--> statement-breakpoint
CREATE UNIQUE INDEX `xp_ledger_unique` ON `xp_ledger` (`wallet`,`reason`,`ref`);