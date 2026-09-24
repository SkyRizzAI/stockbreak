/**
 * All DB access for web, worker and MCP (CLAUDE.md: DB only via packages/db).
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import type { Db } from "./client";
import {
  authNonces,
  badges,
  events,
  faucetClaims,
  indexerState,
  indexes,
  indexSnapshots,
  positions,
  prices,
  signIntents,
  socialFollows,
  users,
  xpLedger,
} from "./schema";

export type IndexRow = typeof indexes.$inferSelect;
export type IndexInsert = typeof indexes.$inferInsert;
export type SnapshotRow = typeof indexSnapshots.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type IntentRow = typeof signIntents.$inferSelect;
export type PriceRow = typeof prices.$inferSelect;

export const BENCHMARK_INDEX = "benchmark:SPYx";

// ---------------- indexes ----------------

export async function upsertIndex(db: Db, row: IndexInsert): Promise<void> {
  const {
    pubkey: _pk,
    createdAt: _c,
    description: _d,
    thesis: _t,
    lookupTable: _l,
    ...update
  } = row;
  await db
    .insert(indexes)
    .values(row)
    .onConflictDoUpdate({ target: indexes.pubkey, set: { ...update, updatedAt: new Date() } });
}

export async function getIndex(db: Db, pubkey: string): Promise<IndexRow | undefined> {
  return (await db.select().from(indexes).where(eq(indexes.pubkey, pubkey)).limit(1))[0];
}

export async function allIndexes(db: Db): Promise<IndexRow[]> {
  return db.select().from(indexes).orderBy(desc(indexes.createdAt));
}

export async function setIndexMeta(
  db: Db,
  pubkey: string,
  meta: { description?: string | null; thesis?: string | null },
): Promise<void> {
  await db
    .update(indexes)
    .set({ ...meta, updatedAt: new Date() })
    .where(eq(indexes.pubkey, pubkey));
}

export async function setLookupTable(db: Db, pubkey: string, lookupTable: string): Promise<void> {
  await db.update(indexes).set({ lookupTable }).where(eq(indexes.pubkey, pubkey));
}

export async function childrenOf(db: Db, parent: string): Promise<IndexRow[]> {
  return db.select().from(indexes).where(eq(indexes.parent, parent));
}

export async function indexesByCreator(db: Db, creator: string): Promise<IndexRow[]> {
  return db
    .select()
    .from(indexes)
    .where(eq(indexes.creator, creator))
    .orderBy(desc(indexes.createdAt));
}

export async function searchIndexes(db: Db, q: string, limit = 10): Promise<IndexRow[]> {
  const like = `%${q}%`;
  return db
    .select()
    .from(indexes)
    .where(or(ilike(indexes.name, like), ilike(indexes.symbol, like), ilike(indexes.pubkey, like)))
    .limit(limit);
}

// ---------------- snapshots ----------------

export async function insertSnapshot(
  db: Db,
  row: typeof indexSnapshots.$inferInsert,
): Promise<void> {
  await db.insert(indexSnapshots).values(row).onConflictDoNothing();
}

export async function insertSnapshots(
  db: Db,
  rows: (typeof indexSnapshots.$inferInsert)[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += 500)
    await db
      .insert(indexSnapshots)
      .values(rows.slice(i, i + 500))
      .onConflictDoNothing();
}

export async function snapshotSeries(db: Db, index: string, since: Date): Promise<SnapshotRow[]> {
  return db
    .select()
    .from(indexSnapshots)
    .where(and(eq(indexSnapshots.index, index), gte(indexSnapshots.ts, since)))
    .orderBy(asc(indexSnapshots.ts));
}

export async function latestSnapshot(db: Db, index: string): Promise<SnapshotRow | undefined> {
  return (
    await db
      .select()
      .from(indexSnapshots)
      .where(eq(indexSnapshots.index, index))
      .orderBy(desc(indexSnapshots.ts))
      .limit(1)
  )[0];
}

/** Latest snapshot per index (one query). */
export async function latestSnapshots(db: Db): Promise<Map<string, SnapshotRow>> {
  const rows = await db.execute<{
    index: string;
    ts: Date;
    nav_micro_usd: string;
    supply: string;
    share_price_micro_usd: string;
    weights: unknown;
    synthetic: boolean;
  }>(sql`SELECT DISTINCT ON (index) * FROM index_snapshots ORDER BY index, ts DESC`);
  const out = new Map<string, SnapshotRow>();
  for (const r of rows) {
    out.set(r.index, {
      index: r.index,
      ts: new Date(r.ts),
      navMicroUsd: BigInt(r.nav_micro_usd),
      supply: BigInt(r.supply),
      sharePriceMicroUsd: BigInt(r.share_price_micro_usd),
      weights: r.weights,
      synthetic: r.synthetic,
    });
  }
  return out;
}

/** Share price at or before `at` per index (for period returns). */
export async function sharePricesAt(db: Db, at: Date): Promise<Map<string, bigint>> {
  const rows = await db.execute<{ index: string; share_price_micro_usd: string }>(
    sql`SELECT DISTINCT ON (index) index, share_price_micro_usd FROM index_snapshots WHERE ts <= ${at.toISOString()}::timestamptz ORDER BY index, ts DESC`,
  );
  const firsts = await db.execute<{ index: string; share_price_micro_usd: string }>(
    sql`SELECT DISTINCT ON (index) index, share_price_micro_usd FROM index_snapshots ORDER BY index, ts ASC`,
  );
  const out = new Map<string, bigint>();
  for (const r of firsts) out.set(r.index, BigInt(r.share_price_micro_usd));
  for (const r of rows) out.set(r.index, BigInt(r.share_price_micro_usd));
  return out;
}

/** Daily closing share price per index since `since` (sparklines). */
export async function dailyCloses(
  db: Db,
  since: Date,
): Promise<Map<string, { ts: Date; v: bigint }[]>> {
  const rows = await db.execute<{ index: string; d: Date; share_price_micro_usd: string }>(
    sql`SELECT DISTINCT ON (index, date_trunc('day', ts)) index, date_trunc('day', ts) AS d, share_price_micro_usd
        FROM index_snapshots WHERE ts >= ${since.toISOString()}::timestamptz
        ORDER BY index, date_trunc('day', ts), ts DESC`,
  );
  const out = new Map<string, { ts: Date; v: bigint }[]>();
  for (const r of rows) {
    const list = out.get(r.index) ?? [];
    list.push({ ts: new Date(r.d), v: BigInt(r.share_price_micro_usd) });
    out.set(r.index, list);
  }
  return out;
}

/** Recent raw snapshots per index (intraday sparklines for young indexes). */
export async function recentSnapshots(db: Db, index: string, limit = 60): Promise<SnapshotRow[]> {
  const rows = await db
    .select()
    .from(indexSnapshots)
    .where(eq(indexSnapshots.index, index))
    .orderBy(desc(indexSnapshots.ts))
    .limit(limit);
  return rows.reverse();
}

export async function countSnapshots(db: Db): Promise<number> {
  return (await db.select({ n: count() }).from(indexSnapshots))[0]?.n ?? 0;
}

// ---------------- positions ----------------

export async function upsertPosition(db: Db, row: typeof positions.$inferInsert): Promise<void> {
  await db
    .insert(positions)
    .values(row)
    .onConflictDoUpdate({
      target: [positions.wallet, positions.index],
      set: { shares: row.shares, costBasisMicroUsd: row.costBasisMicroUsd, updatedAt: new Date() },
    });
}

export async function getPosition(
  db: Db,
  wallet: string,
  index: string,
): Promise<PositionRow | undefined> {
  return (
    await db
      .select()
      .from(positions)
      .where(and(eq(positions.wallet, wallet), eq(positions.index, index)))
      .limit(1)
  )[0];
}

export async function deletePosition(db: Db, wallet: string, index: string): Promise<void> {
  await db.delete(positions).where(and(eq(positions.wallet, wallet), eq(positions.index, index)));
}

export async function positionsByWallet(db: Db, wallet: string): Promise<PositionRow[]> {
  return db
    .select()
    .from(positions)
    .where(and(eq(positions.wallet, wallet), sql`${positions.shares} > 0`));
}

export async function holdersOf(db: Db, index: string): Promise<PositionRow[]> {
  return db
    .select()
    .from(positions)
    .where(and(eq(positions.index, index), sql`${positions.shares} > 0`))
    .orderBy(desc(positions.shares));
}

export async function holderCounts(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({ index: positions.index, n: count() })
    .from(positions)
    .where(sql`${positions.shares} > 0 AND ${positions.wallet} <> ${positions.index}`)
    .groupBy(positions.index);
  return new Map(rows.map((r) => [r.index, r.n]));
}

// ---------------- events ----------------

export async function insertEvents(db: Db, rows: (typeof events.$inferInsert)[]): Promise<number> {
  if (!rows.length) return 0;
  const res = await db
    .insert(events)
    .values(rows)
    .onConflictDoNothing()
    .returning({ s: events.signature });
  return res.length;
}

export async function activity(
  db: Db,
  filter: { index?: string; wallet?: string; types?: string[] },
  limit = 50,
): Promise<EventRow[]> {
  const conds = [];
  if (filter.index) conds.push(eq(events.index, filter.index));
  if (filter.wallet) conds.push(eq(events.wallet, filter.wallet));
  if (filter.types?.length) conds.push(inArray(events.type, filter.types));
  return db
    .select()
    .from(events)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(events.ts), desc(events.ixIndex))
    .limit(limit);
}

export async function eventsOfType(db: Db, types: string[]): Promise<EventRow[]> {
  return db.select().from(events).where(inArray(events.type, types)).orderBy(asc(events.ts));
}

export async function countEvents(db: Db): Promise<number> {
  return (await db.select({ n: count() }).from(events))[0]?.n ?? 0;
}

// ---------------- indexer state ----------------

export async function getIndexerState(db: Db, program: string) {
  return (
    await db.select().from(indexerState).where(eq(indexerState.program, program)).limit(1)
  )[0];
}

export async function setIndexerState(
  db: Db,
  program: string,
  lastSignature: string,
  lastSlot: bigint,
): Promise<void> {
  await db
    .insert(indexerState)
    .values({ program, lastSignature, lastSlot })
    .onConflictDoUpdate({
      target: indexerState.program,
      set: { lastSignature, lastSlot, updatedAt: new Date() },
    });
}

// ---------------- prices ----------------

export async function insertPrices(db: Db, rows: (typeof prices.$inferInsert)[]): Promise<void> {
  if (rows.length) await db.insert(prices).values(rows).onConflictDoNothing();
}

export async function latestPrices(db: Db): Promise<PriceRow[]> {
  const rows = await db.execute<{
    symbol: string;
    ts: Date;
    price_micro_usd: string;
    source: string;
    synthetic: boolean;
  }>(
    sql`SELECT DISTINCT ON (symbol) symbol, ts, price_micro_usd, source, synthetic FROM prices ORDER BY symbol, ts DESC`,
  );
  return rows.map((r) => ({
    symbol: r.symbol,
    ts: new Date(r.ts),
    priceMicroUsd: BigInt(r.price_micro_usd),
    source: r.source,
    synthetic: r.synthetic,
  }));
}

export async function priceAt(db: Db, symbol: string, at: Date): Promise<bigint | null> {
  const r = await db
    .select({ p: prices.priceMicroUsd })
    .from(prices)
    .where(and(eq(prices.symbol, symbol), lt(prices.ts, at)))
    .orderBy(desc(prices.ts))
    .limit(1);
  return r[0]?.p ?? null;
}

export async function priceSeries(db: Db, symbol: string, since: Date): Promise<PriceRow[]> {
  return db
    .select()
    .from(prices)
    .where(and(eq(prices.symbol, symbol), gte(prices.ts, since)))
    .orderBy(asc(prices.ts));
}

// ---------------- users & auth ----------------

export async function getUser(db: Db, wallet: string): Promise<UserRow | undefined> {
  return (await db.select().from(users).where(eq(users.wallet, wallet)).limit(1))[0];
}

export async function getUsers(db: Db, wallets: string[]): Promise<Map<string, UserRow>> {
  if (!wallets.length) return new Map();
  const rows = await db.select().from(users).where(inArray(users.wallet, wallets));
  return new Map(rows.map((r) => [r.wallet, r]));
}

export async function ensureUser(db: Db, wallet: string): Promise<UserRow> {
  await db.insert(users).values({ wallet, avatarSeed: wallet }).onConflictDoNothing();
  return (await getUser(db, wallet)) as UserRow;
}

export async function updateUser(
  db: Db,
  wallet: string,
  patch: { handle?: string | null; bio?: string | null },
): Promise<UserRow> {
  await ensureUser(db, wallet);
  await db.update(users).set(patch).where(eq(users.wallet, wallet));
  return (await getUser(db, wallet)) as UserRow;
}

export async function handleTaken(db: Db, handle: string, wallet: string): Promise<boolean> {
  const r = await db
    .select({ w: users.wallet })
    .from(users)
    .where(eq(users.handle, handle))
    .limit(1);
  return !!r[0] && r[0].w !== wallet;
}

export async function registerAgent(db: Db, wallet: string, agentName: string): Promise<UserRow> {
  await ensureUser(db, wallet);
  await db.update(users).set({ isAgent: true, agentName }).where(eq(users.wallet, wallet));
  await db.update(indexes).set({ isAgentIndex: true }).where(eq(indexes.creator, wallet));
  return (await getUser(db, wallet)) as UserRow;
}

export async function agents(db: Db): Promise<UserRow[]> {
  return db.select().from(users).where(eq(users.isAgent, true)).orderBy(asc(users.createdAt));
}

export async function createNonce(
  db: Db,
  wallet: string,
  purpose: string,
  ttlSecs = 300,
): Promise<string> {
  const nonce = crypto.randomUUID();
  await db
    .insert(authNonces)
    .values({ nonce, wallet, purpose, expiresAt: new Date(Date.now() + ttlSecs * 1000) });
  return nonce;
}

/** Mark a nonce used; returns false when missing/expired/used or bound to another wallet/purpose. */
export async function consumeNonce(
  db: Db,
  nonce: string,
  wallet: string,
  purpose: string,
): Promise<boolean> {
  const r = await db
    .update(authNonces)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authNonces.nonce, nonce),
        eq(authNonces.wallet, wallet),
        eq(authNonces.purpose, purpose),
        sql`${authNonces.usedAt} IS NULL`,
        gte(authNonces.expiresAt, new Date()),
      ),
    )
    .returning({ n: authNonces.nonce });
  return r.length === 1;
}

// ---------------- sign intents ----------------

export async function createIntent(
  db: Db,
  row: typeof signIntents.$inferInsert,
): Promise<IntentRow> {
  return (await db.insert(signIntents).values(row).returning())[0] as IntentRow;
}

export async function getIntent(db: Db, id: string): Promise<IntentRow | undefined> {
  return (await db.select().from(signIntents).where(eq(signIntents.id, id)).limit(1))[0];
}

export async function updateIntent(
  db: Db,
  id: string,
  patch: { status?: string; signatures?: unknown; wallet?: string | null },
): Promise<void> {
  await db.update(signIntents).set(patch).where(eq(signIntents.id, id));
}

export async function setIntentParams(db: Db, id: string, params: unknown): Promise<void> {
  await db.update(signIntents).set({ params }).where(eq(signIntents.id, id));
}

// ---------------- social ----------------

export async function setFollow(
  db: Db,
  follower: string,
  followee: string,
  on: boolean,
): Promise<void> {
  if (on) await db.insert(socialFollows).values({ follower, followee }).onConflictDoNothing();
  else
    await db
      .delete(socialFollows)
      .where(and(eq(socialFollows.follower, follower), eq(socialFollows.followee, followee)));
}

export async function followStats(db: Db, wallet: string, viewer?: string) {
  const followers =
    (
      await db.select({ n: count() }).from(socialFollows).where(eq(socialFollows.followee, wallet))
    )[0]?.n ?? 0;
  const following =
    (
      await db.select({ n: count() }).from(socialFollows).where(eq(socialFollows.follower, wallet))
    )[0]?.n ?? 0;
  let isFollowing = false;
  if (viewer) {
    isFollowing =
      (
        await db
          .select()
          .from(socialFollows)
          .where(and(eq(socialFollows.follower, viewer), eq(socialFollows.followee, wallet)))
          .limit(1)
      ).length > 0;
  }
  return { followers, following, isFollowing };
}

// ---------------- gamification ----------------

export async function awardXp(
  db: Db,
  rows: { wallet: string; amount: number; reason: string; ref: string }[],
): Promise<number> {
  if (!rows.length) return 0;
  const r = await db
    .insert(xpLedger)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: xpLedger.id });
  return r.length;
}

export async function xpOf(db: Db, wallet: string): Promise<number> {
  const r = await db
    .select({ xp: sql<string>`COALESCE(SUM(${xpLedger.amount}), 0)` })
    .from(xpLedger)
    .where(eq(xpLedger.wallet, wallet));
  return Number(r[0]?.xp ?? 0);
}

export async function xpTotals(db: Db): Promise<Map<string, number>> {
  const r = await db
    .select({ w: xpLedger.wallet, xp: sql<string>`SUM(${xpLedger.amount})` })
    .from(xpLedger)
    .groupBy(xpLedger.wallet);
  return new Map(r.map((x) => [x.w, Number(x.xp)]));
}

export async function xpHistory(db: Db, wallet: string, limit = 20) {
  return db
    .select()
    .from(xpLedger)
    .where(eq(xpLedger.wallet, wallet))
    .orderBy(desc(xpLedger.createdAt))
    .limit(limit);
}

export async function awardBadge(db: Db, wallet: string, badge: string): Promise<boolean> {
  const r = await db
    .insert(badges)
    .values({ wallet, badge })
    .onConflictDoNothing()
    .returning({ b: badges.badge });
  return r.length === 1;
}

export async function badgesOf(db: Db, wallet: string) {
  return db.select().from(badges).where(eq(badges.wallet, wallet)).orderBy(asc(badges.awardedAt));
}

export async function countTable(
  db: Db,
  table: "users" | "badges" | "xp_ledger" | "positions" | "indexes" | "prices",
): Promise<number> {
  const r = await db.execute<{ n: string }>(sql.raw(`SELECT COUNT(*)::text AS n FROM ${table}`));
  return Number(r[0]?.n ?? 0);
}

export const levelOf = (xp: number): number => Math.floor(Math.sqrt(xp / 50));

// ---------------- faucet ----------------

export async function recordFaucet(db: Db, row: typeof faucetClaims.$inferInsert): Promise<void> {
  await db.insert(faucetClaims).values(row);
}

export async function faucetSince(
  db: Db,
  filter: { wallet?: string; kind: string; cluster: string },
  since: Date,
): Promise<bigint> {
  const conds = [
    eq(faucetClaims.kind, filter.kind),
    eq(faucetClaims.cluster, filter.cluster),
    gte(faucetClaims.createdAt, since),
  ];
  if (filter.wallet) conds.push(eq(faucetClaims.wallet, filter.wallet));
  const r = await db
    .select({ s: sql<string>`COALESCE(SUM(${faucetClaims.amount}), 0)` })
    .from(faucetClaims)
    .where(and(...conds));
  return BigInt(r[0]?.s ?? "0");
}

export { isNotNull };

/** Drop faucet claims made since `since` (automated test wallets) so they do not use up the daily budget. */
export async function clearFaucetClaimsSince(
  db: Db,
  cluster: string,
  since: Date,
): Promise<number> {
  const rows = await db
    .delete(faucetClaims)
    .where(and(eq(faucetClaims.cluster, cluster), gte(faucetClaims.createdAt, since)))
    .returning({ id: faucetClaims.id });
  return rows.length;
}
