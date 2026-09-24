/**
 * A fresh local validator means all chain-derived rows are stale. Keep only
 * user profiles, social follows and sign-in sessions (keyed by wallet, still meaningful).
 */
import { getDb, schema } from "@repo/db";
import { sql } from "drizzle-orm";

const CHAIN_TABLES = [
  "indexes",
  "index_snapshots",
  "positions",
  "events",
  "indexer_state",
  "sign_intents",
  "xp_ledger",
  "badges",
  "prices",
  "faucet_claims",
  // Social feed rows reference chain state (indexes, on-chain activity).
  "posts",
  "post_likes",
  "post_comments",
] as const;

export async function resetChainTables(url = process.env.DATABASE_URL): Promise<void> {
  const db = getDb(url);
  void schema;
  await db.execute(sql.raw(`TRUNCATE ${CHAIN_TABLES.join(", ")}`));
  console.log(`[db] reset chain tables (${CHAIN_TABLES.length})`);
}
