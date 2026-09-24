/**
 * Database contract (PLAN §7.3). Frozen after P2 — change only via Contract change.
 * On-chain is the source of truth; these tables are cache + social + history.
 * u64 amounts are stored as bigint (mode "bigint").
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const u64 = (name: string) => bigint(name, { mode: "bigint" });

export const users = pgTable("users", {
  wallet: text("wallet").primaryKey(),
  handle: text("handle").unique(),
  avatarSeed: text("avatar_seed").notNull(),
  bio: text("bio"),
  isAgent: boolean("is_agent").notNull().default(false),
  agentName: text("agent_name"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  wallet: text("wallet").notNull(),
  purpose: text("purpose").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const indexes = pgTable(
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
    followsParent: boolean("follows_parent").notNull().default(false),
    assets: jsonb("assets").notNull(),
    fees: jsonb("fees").notNull(),
    strategy: jsonb("strategy").notNull(),
    managers: jsonb("managers").notNull(),
    pendingUpdate: jsonb("pending_update"),
    paused: boolean("paused").notNull().default(false),
    lookupTable: text("lookup_table"),
    isAgentIndex: boolean("is_agent_index").notNull().default(false),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("indexes_creator_idx").on(t.creator), index("indexes_parent_idx").on(t.parent)],
);

export const indexSnapshots = pgTable(
  "index_snapshots",
  {
    index: text("index").notNull(),
    ts: ts("ts").notNull(),
    navMicroUsd: u64("nav_micro_usd").notNull(),
    supply: u64("supply").notNull(),
    sharePriceMicroUsd: u64("share_price_micro_usd").notNull(),
    weights: jsonb("weights").notNull(),
    synthetic: boolean("synthetic").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.index, t.ts] })],
);

export const positions = pgTable(
  "positions",
  {
    wallet: text("wallet").notNull(),
    index: text("index").notNull(),
    shares: u64("shares").notNull(),
    costBasisMicroUsd: u64("cost_basis_micro_usd").notNull(),
    firstJoinedAt: ts("first_joined_at").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.wallet, t.index] }), index("positions_index_idx").on(t.index)],
);

export const events = pgTable(
  "events",
  {
    signature: text("signature").notNull(),
    ixIndex: integer("ix_index").notNull(),
    type: text("type").notNull(),
    index: text("index"),
    wallet: text("wallet"),
    slot: u64("slot").notNull(),
    data: jsonb("data").notNull(),
    ts: ts("ts").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.signature, t.ixIndex] }),
    index("events_index_ts_idx").on(t.index, t.ts),
    index("events_wallet_idx").on(t.wallet),
    index("events_type_idx").on(t.type),
  ],
);

export const indexerState = pgTable("indexer_state", {
  program: text("program").primaryKey(),
  lastSignature: text("last_signature"),
  lastSlot: u64("last_slot"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const signIntents = pgTable("sign_intents", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  params: jsonb("params").notNull(),
  wallet: text("wallet"),
  createdBy: text("created_by").notNull(),
  status: text("status").notNull().default("pending"),
  signatures: jsonb("signatures").notNull().default([]),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
});

export const socialFollows = pgTable(
  "social_follows",
  {
    follower: text("follower").notNull(),
    followee: text("followee").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.follower, t.followee] })],
);

export const xpLedger = pgTable(
  "xp_ledger",
  {
    id: serial("id").primaryKey(),
    wallet: text("wallet").notNull(),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    ref: text("ref").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("xp_ledger_unique").on(t.wallet, t.reason, t.ref),
    index("xp_wallet_idx").on(t.wallet),
  ],
);

export const badges = pgTable(
  "badges",
  {
    wallet: text("wallet").notNull(),
    badge: text("badge").notNull(),
    awardedAt: ts("awarded_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.wallet, t.badge] })],
);

export const prices = pgTable(
  "prices",
  {
    symbol: text("symbol").notNull(),
    ts: ts("ts").notNull(),
    priceMicroUsd: u64("price_micro_usd").notNull(),
    source: text("source").notNull(),
    synthetic: boolean("synthetic").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.ts] })],
);

export const faucetClaims = pgTable(
  "faucet_claims",
  {
    id: serial("id").primaryKey(),
    wallet: text("wallet").notNull(),
    kind: text("kind").notNull(),
    amount: u64("amount").notNull(),
    cluster: text("cluster").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("faucet_claims_wallet_idx").on(t.wallet, t.kind, t.createdAt)],
);

// ---------------- social feed (D033) ----------------

/** Sign-in sessions for social writes. Only a SHA-256 hash of the cookie token is stored. */
export const authSessions = pgTable(
  "auth_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    wallet: text("wallet").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("auth_sessions_wallet_idx").on(t.wallet)],
);

export const posts = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    author: text("author").notNull(),
    index: text("index"),
    /** Index card look when sharing an index (D035): mark | tokens | chart. */
    cardVariant: text("card_variant"),
    body: text("body").notNull(),
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("posts_created_idx").on(t.createdAt),
    index("posts_author_idx").on(t.author, t.createdAt),
    index("posts_index_idx").on(t.index, t.createdAt),
  ],
);

export const postLikes = pgTable(
  "post_likes",
  {
    postId: integer("post_id").notNull(),
    wallet: text("wallet").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.wallet] }),
    index("post_likes_wallet_idx").on(t.wallet, t.createdAt),
  ],
);

export const postComments = pgTable(
  "post_comments",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id").notNull(),
    author: text("author").notNull(),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    index("post_comments_post_idx").on(t.postId, t.createdAt),
    index("post_comments_author_idx").on(t.author, t.createdAt),
  ],
);
