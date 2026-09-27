/**
 * Database contract (PLAN §7.3). Frozen after P2 — change only via Contract change.
 * On-chain is the source of truth; these tables are cache + social + history.
 *
 * SQLite dialect (D051): Cloudflare D1 in production, a libSQL file locally.
 * - timestamps: INTEGER epoch milliseconds (mode "timestamp_ms" → Date)
 * - JSON: TEXT (mode "json"); booleans: INTEGER 0/1 (mode "boolean")
 * - u64 amounts: INTEGER mapped to bigint (`u64` below). D1's API has no BigInt and
 *   returns integers as JS numbers, so values above 2^53-1 are rejected on write.
 */
import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export const u64 = customType<{ data: bigint; driverData: number | bigint | string }>({
  dataType: () => "integer",
  toDriver(v: bigint): number {
    if (v < 0n || v > MAX_SAFE) throw new RangeError(`u64 value ${v} is outside the stored range`);
    return Number(v);
  },
  fromDriver: (v) => BigInt(v),
});

const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const now = () => new Date();
const bool = (name: string) => integer(name, { mode: "boolean" });
const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();
const id = (name: string) => integer(name).primaryKey({ autoIncrement: true });
/** SQL-side default for rows written outside the query builder (raw SQL, migrations). */
const nowMs = sql`(cast(strftime('%s', 'now') as integer) * 1000)`;

export const users = sqliteTable("users", {
  wallet: text("wallet").primaryKey(),
  handle: text("handle").unique(),
  avatarSeed: text("avatar_seed").notNull(),
  bio: text("bio"),
  isAgent: bool("is_agent").notNull().default(false),
  agentName: text("agent_name"),
  createdAt: ts("created_at").notNull().default(nowMs).$defaultFn(now),
});

export const authNonces = sqliteTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  wallet: text("wallet").notNull(),
  purpose: text("purpose").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const indexes = sqliteTable(
  "indexes",
  {
    pubkey: text("pubkey").primaryKey(),
    creator: text("creator").notNull(),
    indexId: u64("index_id").notNull(),
    shareMint: text("share_mint").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    uri: text("uri").notNull().default(""),
    description: text("description"),
    thesis: text("thesis"),
    parent: text("parent"),
    followsParent: bool("follows_parent").notNull().default(false),
    assets: json<unknown>("assets").notNull(),
    fees: json<unknown>("fees").notNull(),
    strategy: json<unknown>("strategy").notNull(),
    managers: json<unknown>("managers").notNull(),
    pendingUpdate: json<unknown>("pending_update"),
    paused: bool("paused").notNull().default(false),
    lookupTable: text("lookup_table"),
    isAgentIndex: bool("is_agent_index").notNull().default(false),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull().default(nowMs).$defaultFn(now),
  },
  (t) => [index("indexes_creator_idx").on(t.creator), index("indexes_parent_idx").on(t.parent)],
);

export const indexSnapshots = sqliteTable(
  "index_snapshots",
  {
    index: text("index").notNull(),
    ts: ts("ts").notNull(),
    navMicroUsd: u64("nav_micro_usd").notNull(),
    supply: u64("supply").notNull(),
    sharePriceMicroUsd: u64("share_price_micro_usd").notNull(),
    weights: json<unknown>("weights").notNull(),
    synthetic: bool("synthetic").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.index, t.ts] })],
);

export const positions = sqliteTable(
  "positions",
  {
    wallet: text("wallet").notNull(),
    index: text("index").notNull(),
    shares: u64("shares").notNull(),
    costBasisMicroUsd: u64("cost_basis_micro_usd").notNull(),
    firstJoinedAt: ts("first_joined_at").notNull(),
    updatedAt: ts("updated_at").notNull().default(nowMs).$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.wallet, t.index] }), index("positions_index_idx").on(t.index)],
);

export const events = sqliteTable(
  "events",
  {
    signature: text("signature").notNull(),
    ixIndex: integer("ix_index").notNull(),
    type: text("type").notNull(),
    index: text("index"),
    wallet: text("wallet"),
    slot: u64("slot").notNull(),
    data: json<unknown>("data").notNull(),
    ts: ts("ts").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.signature, t.ixIndex] }),
    index("events_index_ts_idx").on(t.index, t.ts),
    index("events_wallet_idx").on(t.wallet),
    index("events_type_idx").on(t.type),
  ],
);

export const indexerState = sqliteTable("indexer_state", {
  program: text("program").primaryKey(),
  lastSignature: text("last_signature"),
  lastSlot: u64("last_slot"),
  updatedAt: ts("updated_at").notNull().default(nowMs).$defaultFn(now),
});

export const signIntents = sqliteTable("sign_intents", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  params: json<unknown>("params").notNull(),
  wallet: text("wallet"),
  createdBy: text("created_by").notNull(),
  status: text("status").notNull().default("pending"),
  signatures: json<unknown>("signatures").notNull().default([]),
  createdAt: ts("created_at").notNull().default(nowMs).$defaultFn(now),
  expiresAt: ts("expires_at").notNull(),
});

export const socialFollows = sqliteTable(
  "social_follows",
  {
    follower: text("follower").notNull(),
    followee: text("followee").notNull(),
    createdAt: ts("created_at").notNull().default(nowMs).$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.follower, t.followee] })],
);

export const xpLedger = sqliteTable(
  "xp_ledger",
  {
    id: id("id"),
    wallet: text("wallet").notNull(),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    ref: text("ref").notNull(),
    createdAt: ts("created_at").notNull().default(nowMs).$defaultFn(now),
  },
  (t) => [
    unique("xp_ledger_unique").on(t.wallet, t.reason, t.ref),
    index("xp_wallet_idx").on(t.wallet),
  ],
);

export const badges = sqliteTable(
  "badges",
  {
    wallet: text("wallet").notNull(),
    badge: text("badge").notNull(),
    awardedAt: ts("awarded_at").notNull().default(nowMs).$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.wallet, t.badge] })],
);

export const prices = sqliteTable(
  "prices",
  {
    symbol: text("symbol").notNull(),
    ts: ts("ts").notNull(),
    priceMicroUsd: u64("price_micro_usd").notNull(),
    source: text("source").notNull(),
    synthetic: bool("synthetic").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.ts] })],
);

export const faucetClaims = sqliteTable(
  "faucet_claims",
  {
    id: id("id"),
    wallet: text("wallet").notNull(),
    kind: text("kind").notNull(),
    amount: u64("amount").notNull(),
    cluster: text("cluster").notNull(),
    createdAt: ts("created_at").notNull().default(nowMs).$defaultFn(now),
  },
  (t) => [index("faucet_claims_wallet_idx").on(t.wallet, t.kind, t.createdAt)],
);

// ---------------- social feed (D033) ----------------

/** Sign-in sessions for social writes. Only a SHA-256 hash of the cookie token is stored. */
export const authSessions = sqliteTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    wallet: text("wallet").notNull(),
    createdAt: ts("created_at").notNull().default(nowMs).$defaultFn(now),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("auth_sessions_wallet_idx").on(t.wallet)],
);

export const posts = sqliteTable(
  "posts",
  {
    id: id("id"),
    author: text("author").notNull(),
    index: text("index"),
    /** Index card look when sharing an index (D035): mark | tokens | chart. */
    cardVariant: text("card_variant"),
    body: text("body").notNull(),
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    createdAt: ts("created_at").notNull().default(nowMs).$defaultFn(now),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("posts_created_idx").on(t.createdAt),
    index("posts_author_idx").on(t.author, t.createdAt),
    index("posts_index_idx").on(t.index, t.createdAt),
  ],
);

export const postLikes = sqliteTable(
  "post_likes",
  {
    postId: integer("post_id").notNull(),
    wallet: text("wallet").notNull(),
    createdAt: ts("created_at").notNull().default(nowMs).$defaultFn(now),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.wallet] }),
    index("post_likes_wallet_idx").on(t.wallet, t.createdAt),
  ],
);

export const postComments = sqliteTable(
  "post_comments",
  {
    id: id("id"),
    postId: integer("post_id").notNull(),
    author: text("author").notNull(),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull().default(nowMs).$defaultFn(now),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("post_comments_post_idx").on(t.postId, t.createdAt),
    index("post_comments_author_idx").on(t.author, t.createdAt),
  ],
);

/**
 * Server-custodied agent wallets created from the web (D045, custody model A):
 * the ed25519 seed is stored AES-256-GCM encrypted (AGENT_KEY_SECRET). Devnet/localnet only.
 */
export const agentWallets = sqliteTable(
  "agent_wallets",
  {
    wallet: text("wallet").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    secretEnc: text("secret_enc").notNull(),
    createdAt: ts("created_at").notNull().default(nowMs).$defaultFn(now),
  },
  (t) => [index("agent_wallets_owner_idx").on(t.owner)],
);

/** API keys that authenticate remote MCP requests as one agent wallet (D045). Hash only. */
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: id("id"),
    agentWallet: text("agent_wallet")
      .notNull()
      .references(() => agentWallets.wallet),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    createdAt: ts("created_at").notNull().default(nowMs).$defaultFn(now),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("api_keys_agent_idx").on(t.agentWallet), index("api_keys_owner_idx").on(t.owner)],
);

// ---------------- hosted autopilot (D047) ----------------

/**
 * Per-agent autopilot settings: the worker wakes enabled agents every
 * `interval_minutes` and runs one LLM decision cycle with the MCP tools (D047).
 * `run_requested` = a manual "run now" (runs once even when disabled).
 */
export const agentAutopilot = sqliteTable(
  "agent_autopilot",
  {
    agentWallet: text("agent_wallet")
      .primaryKey()
      .references(() => agentWallets.wallet),
    enabled: bool("enabled").notNull().default(false),
    intervalMinutes: integer("interval_minutes").notNull().default(30),
    strategy: text("strategy").notNull().default(""),
    /** Index pubkeys to manage; empty = every index the agent created or manages. */
    indexes: json<string[]>("indexes").notNull().default([]),
    runRequested: bool("run_requested").notNull().default(false),
    lastManualRunAt: ts("last_manual_run_at"),
    updatedAt: ts("updated_at").notNull().default(nowMs).$defaultFn(now),
    lastRunAt: ts("last_run_at"),
    nextRunAt: ts("next_run_at"),
  },
  (t) => [index("agent_autopilot_due_idx").on(t.nextRunAt)],
);

/** Autopilot run log (last 50 per agent are kept). */
export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: id("id"),
    agentWallet: text("agent_wallet")
      .notNull()
      .references(() => agentWallets.wallet),
    startedAt: ts("started_at").notNull().default(nowMs).$defaultFn(now),
    finishedAt: ts("finished_at"),
    /** running | ok | noop | error */
    status: text("status").notNull().default("running"),
    summary: text("summary").notNull().default(""),
    actions: json<{ tool: string; ok: boolean; detail: string }[]>("actions").notNull().default([]),
  },
  (t) => [index("agent_runs_agent_idx").on(t.agentWallet, t.startedAt)],
);

/** Liveness of worker loops that the web reports (e.g. autopilot availability, D047). */
export const workerStatus = sqliteTable("worker_status", {
  name: text("name").primaryKey(),
  info: json<Record<string, unknown>>("info").notNull().default({}),
  updatedAt: ts("updated_at").notNull().default(nowMs).$defaultFn(now),
});
