/**
 * All DB access for web, worker and MCP (CLAUDE.md: DB only via packages/db).
 * SQLite dialect (D051): runs unchanged on Cloudflare D1 and local libSQL.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  like,
  lt,
  lte,
  max,
  min,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
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
import { chunkRows, inList } from "./sqlite";

export type IndexRow = typeof indexes.$inferSelect;
export type IndexInsert = typeof indexes.$inferInsert;
export type SnapshotRow = typeof indexSnapshots.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type IntentRow = typeof signIntents.$inferSelect;
export type PriceRow = typeof prices.$inferSelect;

export const BENCHMARK_INDEX = "benchmark:SPYx";

const DAY_MS = 86_400_000;

/** Run a chunked multi-row insert (D1 parameter limit) and concatenate RETURNING rows. */
async function insertChunked<T, R>(
  table: SQLiteTable,
  rows: T[],
  run: (chunk: T[]) => Promise<R[]>,
): Promise<R[]> {
  const out: R[] = [];
  for (const chunk of chunkRows(table, rows)) out.push(...(await run(chunk)));
  return out;
}

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

/** Case-insensitive (SQLite LIKE ignores ASCII case). */
export async function searchIndexes(db: Db, q: string, limit = 10): Promise<IndexRow[]> {
  const pattern = `%${q}%`;
  return db
    .select()
    .from(indexes)
    .where(
      or(like(indexes.name, pattern), like(indexes.symbol, pattern), like(indexes.pubkey, pattern)),
    )
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
  for (const chunk of chunkRows(indexSnapshots, rows))
    await db.insert(indexSnapshots).values(chunk).onConflictDoNothing();
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

/**
 * Snapshot rows whose ts is the per-index extreme (`pick`) within `where`, keyed by index.
 * (Portable replacement for Postgres DISTINCT ON.)
 */
async function snapshotsAtEdge(
  db: Db,
  pick: "max" | "min",
  where?: ReturnType<typeof and>,
): Promise<Map<string, SnapshotRow>> {
  const edge = db
    .select({
      index: indexSnapshots.index,
      ts: (pick === "max" ? max(indexSnapshots.ts) : min(indexSnapshots.ts)).as("edge_ts"),
    })
    .from(indexSnapshots)
    .where(where)
    .groupBy(indexSnapshots.index)
    .as("edge");
  const rows = await db
    .select({ s: indexSnapshots })
    .from(indexSnapshots)
    .innerJoin(edge, and(eq(indexSnapshots.index, edge.index), eq(indexSnapshots.ts, edge.ts)));
  return new Map(rows.map(({ s }) => [s.index, s]));
}

/** Latest snapshot per index (one query). */
export async function latestSnapshots(db: Db): Promise<Map<string, SnapshotRow>> {
  return snapshotsAtEdge(db, "max");
}

/**
 * Share price at or before `at` per index (for period returns). An index with
 * no snapshot that old is omitted (caller shows "—") unless its first snapshot
 * lies within a tolerance of `at` (max(6h, 10% of the window)), in which case
 * that first snapshot is used. Pass `fallbackToFirst` (or `at` = epoch, kept
 * for existing callers) for "all-time" returns; see also `firstSharePrices`.
 */
export async function sharePricesAt(
  db: Db,
  at: Date,
  opts: { fallbackToFirst?: boolean } = {},
): Promise<Map<string, bigint>> {
  const atOrBefore = await snapshotsAtEdge(db, "max", and(lte(indexSnapshots.ts, at)));
  const windowMs = Math.max(0, Date.now() - at.getTime());
  const toleranceMs = Math.max(6 * 3_600_000, Math.floor(windowMs / 10));
  const firstLimit =
    opts.fallbackToFirst || at.getTime() <= 0 ? null : new Date(at.getTime() + toleranceMs);
  const firsts = await snapshotsAtEdge(db, "min");
  const out = new Map<string, bigint>();
  for (const r of firsts.values()) {
    if (firstLimit && r.ts.getTime() > firstLimit.getTime()) continue;
    out.set(r.index, r.sharePriceMicroUsd);
  }
  for (const r of atOrBefore.values()) out.set(r.index, r.sharePriceMicroUsd);
  return out;
}

/** Earliest snapshot share price per index (all-time returns). */
export async function firstSharePrices(db: Db): Promise<Map<string, bigint>> {
  return sharePricesAt(db, new Date(0), { fallbackToFirst: true });
}

/** Daily closing share price per index since `since` (sparklines), UTC days. */
export async function dailyCloses(
  db: Db,
  since: Date,
): Promise<Map<string, { ts: Date; v: bigint }[]>> {
  // Integer division (a bound number may arrive as REAL and keep the fraction).
  const day = sql`cast(${indexSnapshots.ts} / ${sql.raw(String(DAY_MS))} as integer)`;
  const closes = db
    .select({ index: indexSnapshots.index, ts: max(indexSnapshots.ts).as("close_ts") })
    .from(indexSnapshots)
    .where(gte(indexSnapshots.ts, since))
    .groupBy(indexSnapshots.index, day)
    .as("closes");
  const rows = await db
    .select({
      index: indexSnapshots.index,
      ts: indexSnapshots.ts,
      v: indexSnapshots.sharePriceMicroUsd,
    })
    .from(indexSnapshots)
    .innerJoin(
      closes,
      and(eq(indexSnapshots.index, closes.index), eq(indexSnapshots.ts, closes.ts)),
    )
    .orderBy(asc(indexSnapshots.index), asc(indexSnapshots.ts));
  const out = new Map<string, { ts: Date; v: bigint }[]>();
  for (const r of rows) {
    const list = out.get(r.index) ?? [];
    list.push({ ts: new Date(Math.floor(r.ts.getTime() / DAY_MS) * DAY_MS), v: r.v });
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

export async function allPositions(db: Db): Promise<PositionRow[]> {
  return db.select().from(positions);
}

/** One position change derived from an indexed event (shares at event time, not chain now). */
export interface PositionDelta {
  wallet: string;
  index: string;
  /** Shares received (join, fee claim). */
  addShares?: bigint;
  /** Cost basis added with `addShares` (micro-USD). */
  addCostMicroUsd?: bigint;
  /** Shares burned (redeem). */
  burnShares?: bigint;
  /** Event time (used as firstJoinedAt for a new position). */
  ts: Date;
}

/**
 * Pure position update: burns remove cost pro-rata to min(burned, prevShares)/prevShares,
 * receipts add their cost. Never goes negative.
 */
export function applyDelta(
  prev: { shares: bigint; costBasisMicroUsd: bigint } | undefined,
  d: { addShares?: bigint; addCostMicroUsd?: bigint; burnShares?: bigint },
): { shares: bigint; costBasisMicroUsd: bigint } {
  let shares = prev?.shares ?? 0n;
  let cost = prev?.costBasisMicroUsd ?? 0n;
  const burn = d.burnShares ?? 0n;
  if (burn > 0n) {
    if (shares > 0n) {
      const b = burn < shares ? burn : shares;
      cost -= (cost * b) / shares;
      shares -= b;
    }
    if (shares === 0n) cost = 0n;
  }
  const add = d.addShares ?? 0n;
  if (add > 0n) {
    shares += add;
    cost += d.addCostMicroUsd ?? 0n;
  }
  return { shares, costBasisMicroUsd: cost < 0n ? 0n : cost };
}

/**
 * Pure reconciliation of a stored position against the on-chain share balance
 * (share transfers are not indexed): fewer shares scale cost down pro-rata,
 * more shares add cost at `sharePriceMicroUsd`.
 */
export function reconcileDelta(
  prev: { shares: bigint; costBasisMicroUsd: bigint } | undefined,
  chainShares: bigint,
  sharePriceMicroUsd: bigint,
): { shares: bigint; costBasisMicroUsd: bigint } {
  if (chainShares <= 0n) return { shares: 0n, costBasisMicroUsd: 0n };
  const shares = prev?.shares ?? 0n;
  let cost = prev?.costBasisMicroUsd ?? 0n;
  if (chainShares < shares) cost = (cost * chainShares) / shares;
  else if (chainShares > shares) cost += ((chainShares - shares) * sharePriceMicroUsd) / 1_000_000n;
  return { shares: chainShares, costBasisMicroUsd: cost };
}

/** The statement that stores a position (a delete when it is empty); not executed. */
function positionWrite(
  db: Db,
  wallet: string,
  index: string,
  next: { shares: bigint; costBasisMicroUsd: bigint },
  firstJoinedAt: Date,
) {
  if (next.shares <= 0n)
    return db
      .delete(positions)
      .where(and(eq(positions.wallet, wallet), eq(positions.index, index)));
  return db
    .insert(positions)
    .values({ wallet, index, ...next, firstJoinedAt })
    .onConflictDoUpdate({
      target: [positions.wallet, positions.index],
      set: { ...next, updatedAt: new Date() },
    });
}

/**
 * Store one transaction's events, apply the position deltas of the events that are new
 * (replays are no-ops) and advance the indexer cursor to this transaction, as one atomic
 * batch (D1 has no interactive transactions). The indexer is the only writer of events
 * and positions. Returns the number of new event rows.
 */
export async function applyIndexedTx(
  db: Db,
  input: {
    program: string;
    signature: string;
    slot: bigint;
    events: (typeof events.$inferInsert)[];
    /** Keyed by the event's ixIndex. */
    deltas: Map<number, PositionDelta>;
  },
): Promise<number> {
  const stored = new Set(
    (
      await db
        .select({ ixIndex: events.ixIndex })
        .from(events)
        .where(eq(events.signature, input.signature))
    ).map((r) => r.ixIndex),
  );
  const fresh = input.events.filter((e) => !stored.has(e.ixIndex));
  // Positions after this tx, per wallet+index (several events may touch the same one).
  const next = new Map<
    string,
    {
      wallet: string;
      index: string;
      pos: { shares: bigint; costBasisMicroUsd: bigint };
      first: Date;
    }
  >();
  for (const e of fresh) {
    const d = input.deltas.get(e.ixIndex);
    if (!d || d.wallet === d.index) continue;
    const key = `${d.wallet}:${d.index}`;
    let cur = next.get(key);
    if (!cur) {
      const row = await getPosition(db, d.wallet, d.index);
      cur = {
        wallet: d.wallet,
        index: d.index,
        pos: row ?? { shares: 0n, costBasisMicroUsd: 0n },
        first: row?.firstJoinedAt ?? d.ts,
      };
      next.set(key, cur);
    }
    cur.pos = applyDelta(cur.pos, d);
  }
  const cursor = db
    .insert(indexerState)
    .values({ program: input.program, lastSignature: input.signature, lastSlot: input.slot })
    .onConflictDoUpdate({
      target: indexerState.program,
      set: { lastSignature: input.signature, lastSlot: input.slot, updatedAt: new Date() },
    });
  await db.batch([
    cursor,
    ...chunkRows(events, fresh).map((c) => db.insert(events).values(c).onConflictDoNothing()),
    ...[...next.values()].map((p) => positionWrite(db, p.wallet, p.index, p.pos, p.first)),
  ]);
  return fresh.length;
}

/** Bring a stored position in line with the on-chain share balance. Returns true if it changed. */
export async function reconcilePosition(
  db: Db,
  wallet: string,
  index: string,
  chainShares: bigint,
  sharePriceMicroUsd: bigint,
): Promise<boolean> {
  if (wallet === index) return false;
  const prev = await getPosition(db, wallet, index);
  if ((prev?.shares ?? 0n) === chainShares) return false;
  await positionWrite(
    db,
    wallet,
    index,
    reconcileDelta(prev, chainShares, sharePriceMicroUsd),
    prev?.firstJoinedAt ?? new Date(),
  );
  return true;
}

// ---------------- events ----------------

export async function insertEvents(db: Db, rows: (typeof events.$inferInsert)[]): Promise<number> {
  if (!rows.length) return 0;
  const res = await insertChunked(events, rows, (c) =>
    db.insert(events).values(c).onConflictDoNothing().returning({ s: events.signature }),
  );
  return res.length;
}

export async function activity(
  db: Db,
  filter: { index?: string; wallet?: string; types?: string[]; excludeTypes?: string[] },
  limit = 50,
): Promise<EventRow[]> {
  const conds = [];
  if (filter.index) conds.push(eq(events.index, filter.index));
  if (filter.wallet) conds.push(eq(events.wallet, filter.wallet));
  if (filter.types?.length) conds.push(inArray(events.type, filter.types));
  // Excluded before LIMIT: frequent keeper events must not push everything else out.
  if (filter.excludeTypes?.length) conds.push(notInArray(events.type, filter.excludeTypes));
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
  for (const chunk of chunkRows(prices, rows))
    await db.insert(prices).values(chunk).onConflictDoNothing();
}

/** Latest price per symbol (one query). */
export async function latestPrices(db: Db): Promise<PriceRow[]> {
  const last = db
    .select({ symbol: prices.symbol, ts: max(prices.ts).as("last_ts") })
    .from(prices)
    .groupBy(prices.symbol)
    .as("last");
  const rows = await db
    .select({ p: prices })
    .from(prices)
    .innerJoin(last, and(eq(prices.symbol, last.symbol), eq(prices.ts, last.ts)))
    .orderBy(asc(prices.symbol));
  return rows.map((r) => r.p);
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
  const rows = await db.select().from(users).where(inList(users.wallet, wallets));
  return new Map(rows.map((r) => [r.wallet, r]));
}

/** Creators by handle (substring) or wallet (prefix); case-insensitive. */
export async function searchUsers(db: Db, q: string, limit = 6): Promise<UserRow[]> {
  return db
    .select()
    .from(users)
    .where(or(like(users.handle, `%${q}%`), like(users.wallet, `${q}%`)))
    .limit(limit);
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
  const r = await insertChunked(xpLedger, rows, (c) =>
    db.insert(xpLedger).values(c).onConflictDoNothing().returning({ id: xpLedger.id }),
  );
  return r.length;
}

export async function xpOf(db: Db, wallet: string): Promise<number> {
  const r = await db
    .select({ xp: sql<number>`coalesce(sum(${xpLedger.amount}), 0)` })
    .from(xpLedger)
    .where(eq(xpLedger.wallet, wallet));
  return Number(r[0]?.xp ?? 0);
}

export async function xpTotals(db: Db): Promise<Map<string, number>> {
  const r = await db
    .select({ w: xpLedger.wallet, xp: sql<number>`sum(${xpLedger.amount})` })
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

/** Bulk, chunked badge awards (duplicates are ignored). Returns newly awarded count. */
export async function awardBadges(
  db: Db,
  rows: { wallet: string; badge: string }[],
): Promise<number> {
  const r = await insertChunked(badges, rows, (c) =>
    db.insert(badges).values(c).onConflictDoNothing().returning({ b: badges.badge }),
  );
  return r.length;
}

export async function badgesOf(db: Db, wallet: string) {
  return db.select().from(badges).where(eq(badges.wallet, wallet)).orderBy(asc(badges.awardedAt));
}

const COUNTABLE = { users, badges, xp_ledger: xpLedger, positions, indexes, prices } as const;

export async function countTable(db: Db, table: keyof typeof COUNTABLE): Promise<number> {
  return (await db.select({ n: count() }).from(COUNTABLE[table]))[0]?.n ?? 0;
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
    .select({ s: sql<number>`coalesce(sum(${faucetClaims.amount}), 0)` })
    .from(faucetClaims)
    .where(and(...conds));
  return BigInt(Math.trunc(Number(r[0]?.s ?? 0)));
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
