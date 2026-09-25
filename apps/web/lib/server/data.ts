import "server-only";
/** Read models for pages and API routes (DB + live chain valuation). */
import { ASSETS } from "@repo/config";
import {
  activity as activityRows,
  allIndexes,
  BENCHMARK_INDEX,
  badgesOf,
  dailyCloses,
  eventsOfType,
  firstSharePrices,
  followStats,
  getIndex,
  getUser,
  getUsers,
  holderCounts,
  holdersOf,
  type IndexRow,
  latestPrices,
  latestSnapshots,
  levelOf,
  positionsByWallet,
  priceAt,
  recentSnapshots,
  sharePricesAt,
  snapshotSeries,
  xpOf,
} from "@repo/db";
import {
  chainClock,
  configPda,
  fetchConfig,
  fetchMaybeIndex,
  managersOf,
  parentOf,
  valueIndex,
  vault,
} from "@repo/sdk";
import type { Address } from "@solana/kit";
import type {
  ActivityItem,
  AssetKindName,
  AssetPrice,
  Benchmark,
  CreatorRow,
  Holder,
  IndexDetail,
  IndexSummary,
  PendingUpdateJson,
  Portfolio,
  PositionRow,
  Profile,
  SeriesPoint,
  StrategyJson,
  StrategyModeName,
} from "../types";
import { chain, db, symbolOf } from "./ctx";

const DAY = 86_400_000;
const n6 = (v: bigint | string | number | null | undefined) =>
  v === null || v === undefined ? 0 : Number(v) / 1e6;
const assetName = (symbol: string) => ASSETS.find((a) => a.symbol === symbol)?.name ?? symbol;
const ret = (now: bigint | undefined, then: bigint | undefined) =>
  now && then && then > 0n ? Number(now) / Number(then) - 1 : null;

interface AssetJson {
  mint: string;
  symbol: string;
  kind: AssetKindName;
  targetWeightBps: number;
}

// ---------------- summaries ----------------

export async function indexSummaries(filter?: (r: IndexRow) => boolean): Promise<IndexSummary[]> {
  const d = db();
  const rows = (await allIndexes(d)).filter((r) => (filter ? filter(r) : true));
  if (!rows.length) return [];
  const [latest, holders, at24, at7, at30, closes] = await Promise.all([
    latestSnapshots(d),
    holderCounts(d),
    sharePricesAt(d, new Date(Date.now() - DAY)),
    sharePricesAt(d, new Date(Date.now() - 7 * DAY)),
    sharePricesAt(d, new Date(Date.now() - 30 * DAY)),
    dailyCloses(d, new Date(Date.now() - 31 * DAY)),
  ]);
  const first = await firstSharePrices(d);
  const all = await allIndexes(d);
  const users = await getUsers(d, [...new Set(rows.map((r) => r.creator))]);
  const bySymbol = new Map(all.map((r) => [r.pubkey, r.symbol]));
  const clones = new Map<string, number>();
  for (const r of all) if (r.parent) clones.set(r.parent, (clones.get(r.parent) ?? 0) + 1);
  const out: IndexSummary[] = [];
  for (const r of rows) {
    const snap = latest.get(r.pubkey);
    const sp = snap?.sharePriceMicroUsd;
    const assets = (r.assets as AssetJson[]) ?? [];
    let spark = (closes.get(r.pubkey) ?? []).map((p) => n6(p.v));
    let synthetic = false;
    if (spark.length < 3) {
      const recent = await recentSnapshots(d, r.pubkey, 60);
      spark = recent.map((s) => n6(s.sharePriceMicroUsd));
    }
    if (snap && (closes.get(r.pubkey)?.length ?? 0) > 3) synthetic = true;
    const firstSp = first.get(r.pubkey);
    const u = users.get(r.creator);
    out.push({
      pubkey: r.pubkey,
      name: r.name,
      symbol: r.symbol,
      description: r.description ?? null,
      creator: r.creator,
      creatorHandle: u?.handle ?? null,
      creatorIsAgent: u?.isAgent ?? r.isAgentIndex,
      parent: r.parent,
      parentSymbol: r.parent ? (bySymbol.get(r.parent) ?? null) : null,
      followsParent: r.followsParent,
      hasPreIpo: assets.some((a) => a.kind === "PreIpo"),
      assets: assets.map((a) => ({
        mint: a.mint,
        symbol: a.symbol,
        name: assetName(a.symbol),
        kind: a.kind,
        targetWeightBps: a.targetWeightBps,
      })),
      strategyMode: ((r.strategy as { mode?: StrategyModeName }).mode ??
        "Threshold") as StrategyModeName,
      mgmtFeeBps: Number((r.fees as { mgmtFeeBps?: number }).mgmtFeeBps ?? 0),
      navUsd: n6(snap?.navMicroUsd),
      sharePrice: n6(sp),
      ret24h: ret(sp, at24.get(r.pubkey)),
      ret7d: ret(sp, at7.get(r.pubkey)),
      ret30d: ret(sp, at30.get(r.pubkey)),
      retAll: ret(sp, firstSp),
      holders: holders.get(r.pubkey) ?? 0,
      clones: clones.get(r.pubkey) ?? 0,
      createdAt: r.createdAt.toISOString(),
      spark,
      syntheticHistory: synthetic,
      paused: r.paused,
    });
  }
  return out;
}

/** SPYx daily closes (30 d) for cards: drawdown and return next to an index. */
export async function benchmark(): Promise<Benchmark> {
  const d = db();
  const closes = (await dailyCloses(d, new Date(Date.now() - 31 * DAY))).get(BENCHMARK_INDEX) ?? [];
  const spark = closes.map((p) => n6(p.v));
  const r = await benchmarkReturns();
  return { symbol: "SPYx", spark, ret30d: r.ret30d };
}

export async function benchmarkReturns(): Promise<{
  ret24h: number | null;
  ret7d: number | null;
  ret30d: number | null;
  retAll: number | null;
}> {
  const d = db();
  const latest = (await latestSnapshots(d)).get(BENCHMARK_INDEX)?.sharePriceMicroUsd;
  const r = async (ms: number) =>
    ret(latest, (await sharePricesAt(d, new Date(Date.now() - ms))).get(BENCHMARK_INDEX));
  return {
    ret24h: await r(DAY),
    ret7d: await r(7 * DAY),
    ret30d: await r(30 * DAY),
    retAll: ret(latest, (await firstSharePrices(d)).get(BENCHMARK_INDEX)),
  };
}

// ---------------- assets ----------------

export async function assetPrices(): Promise<AssetPrice[]> {
  const d = db();
  const latest = await latestPrices(d);
  const yesterday = new Date(Date.now() - DAY);
  const out: AssetPrice[] = [];
  for (const p of latest) {
    const def = ASSETS.find((a) => a.symbol === p.symbol);
    if (!def) continue;
    const prev = await priceAt(d, p.symbol, yesterday);
    out.push({
      symbol: p.symbol,
      name: def.name,
      kind: def.kind,
      mint: "",
      price: n6(p.priceMicroUsd),
      change24h: prev && prev > 0n ? Number(p.priceMicroUsd) / Number(prev) - 1 : null,
      source: p.source,
      benchmark: !!def.benchmark,
    });
  }
  const order = ASSETS.map((a) => a.symbol);
  return out.sort((a, b) => order.indexOf(a.symbol) - order.indexOf(b.symbol));
}

// ---------------- index detail ----------------

const MODE: StrategyModeName[] = ["Manual", "Threshold", "Periodic"];
const KIND: AssetKindName[] = ["Stock", "PreIpo", "Stable"];

function strategyJson(s: vault.Strategy): StrategyJson {
  return {
    mode: MODE[s.mode] ?? "Threshold",
    driftThresholdBps: s.driftThresholdBps,
    periodSecs: s.periodSecs,
    maxSlippageBps: s.maxSlippageBps,
    cooldownSecs: s.cooldownSecs,
    allowKeeper: s.allowKeeper,
  };
}

export async function chainNow(): Promise<number> {
  return Number(await chainClock(chain()));
}

/** Several panels poll the same index at once: share one computation for a few seconds. */
const detailCache = new Map<string, { at: number; value: Promise<IndexDetail | null> }>();
const DETAIL_TTL_MS = 4_000;

export function indexDetail(pubkey: string): Promise<IndexDetail | null> {
  const hit = detailCache.get(pubkey);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.value;
  const value = computeIndexDetail(pubkey).catch((e: unknown) => {
    detailCache.delete(pubkey);
    throw e;
  });
  detailCache.set(pubkey, { at: Date.now(), value });
  for (const [k, v] of detailCache) if (Date.now() - v.at > 60_000) detailCache.delete(k);
  return value;
}

async function computeIndexDetail(pubkey: string): Promise<IndexDetail | null> {
  const c = chain();
  const d = db();
  const st = await fetchMaybeIndex(c, pubkey as Address);
  if (!st) return null;
  const mgrs = managersOf(st);
  // Independent chain and DB reads in parallel (each devnet RPC round trip is ~0.3–1 s).
  const [row, summaries, v, cfg, mgrUsers, all, ipoEvents] = await Promise.all([
    getIndex(d, pubkey),
    indexSummaries((r) => r.pubkey === pubkey),
    valueIndex(c, st),
    configPda().then((pda) => fetchConfig(c, pda)),
    getUsers(d, mgrs),
    allIndexes(d),
    eventsOfType(d, ["IpoMigrated"]),
  ]);
  const summary = summaries[0];
  const children = all.filter((r) => r.parent === pubkey);
  const ipos = ipoEvents.filter((e) => e.index === pubkey);
  const pending: PendingUpdateJson | null =
    st.pendingUpdate.__option === "Some"
      ? {
          eta: Number(st.pendingUpdate.value.eta),
          assets:
            st.pendingUpdate.value.assets.__option === "Some"
              ? st.pendingUpdate.value.assets.value.map((a) => ({
                  mint: a.mint,
                  symbol: symbolOf(a.mint),
                  targetWeightBps: a.targetWeightBps,
                }))
              : null,
          fees:
            st.pendingUpdate.value.fees.__option === "Some"
              ? st.pendingUpdate.value.fees.value
              : null,
          strategy:
            st.pendingUpdate.value.strategy.__option === "Some"
              ? strategyJson(st.pendingUpdate.value.strategy.value)
              : null,
        }
      : null;
  const parent = parentOf(st);
  const base: IndexSummary =
    summary ??
    ({
      pubkey,
      name: st.name,
      symbol: st.symbol,
      description: row?.description ?? null,
      creator: st.creator,
      creatorHandle: null,
      creatorIsAgent: false,
      parent,
      parentSymbol: null,
      followsParent: st.followsParent,
      hasPreIpo: st.assets.some((a) => a.kind === vault.AssetKind.PreIpo),
      assets: [],
      strategyMode: MODE[st.strategy.mode] ?? "Threshold",
      mgmtFeeBps: st.fees.mgmtFeeBps,
      navUsd: n6(v.nav),
      sharePrice: n6(v.sharePrice),
      ret24h: null,
      ret7d: null,
      ret30d: null,
      retAll: null,
      holders: 0,
      clones: 0,
      createdAt: new Date(Number(st.createdAt) * 1000).toISOString(),
      spark: [],
      syntheticHistory: false,
      paused: st.paused,
    } satisfies IndexSummary);
  return {
    ...base,
    name: st.name,
    symbol: st.symbol,
    paused: st.paused,
    followsParent: st.followsParent,
    parent,
    assets: st.assets.map((a) => ({
      mint: a.mint,
      symbol: symbolOf(a.mint),
      name: assetName(symbolOf(a.mint)),
      kind: KIND[a.kind] ?? "Stock",
      targetWeightBps: a.targetWeightBps,
    })),
    hasPreIpo: st.assets.some((a) => a.kind === vault.AssetKind.PreIpo),
    description: row?.description ?? null,
    thesis: row?.thesis ?? null,
    uri: st.uri,
    shareMint: st.shareMint,
    indexId: st.indexId.toString(),
    lookupTable: row?.lookupTable ?? null,
    managers: mgrs.map((m) => ({
      wallet: m,
      handle: mgrUsers.get(m)?.handle ?? null,
      isAgent: mgrUsers.get(m)?.isAgent ?? false,
    })),
    live: v.assets.map((a) => ({
      mint: a.entry.mint,
      symbol: symbolOf(a.entry.mint),
      name: assetName(symbolOf(a.entry.mint)),
      kind: KIND[a.entry.kind] ?? "Stock",
      tokenProgram: a.entry.tokenProgram,
      oracle: a.entry.oracle,
      decimals: a.entry.decimals,
      balance: a.entry.balance.toString(),
      targetWeightBps: a.targetBps,
      weightBps: a.weightBps,
      valueUsd: n6(a.value),
      priceUsd: a.priceUsd,
      multiplier: a.mint?.multiplier ?? 1,
    })),
    navLiveUsd: n6(v.nav),
    sharePriceLive: n6(v.sharePrice),
    navUsd: n6(v.nav),
    sharePrice: n6(v.sharePrice),
    supply: v.supply.toString(),
    effectiveSupply: v.effectiveSupply.toString(),
    driftSumBps: v.driftSum,
    driftMaxBps: v.driftMax,
    fees: {
      mgmtFeeBps: st.fees.mgmtFeeBps,
      entryFeeBps: st.fees.entryFeeBps,
      exitFeeBps: st.fees.exitFeeBps,
      platformFeeBps: cfg.platformFeeBps,
      cloneRoyaltyBps: cfg.cloneRoyaltyBps,
    },
    owed: {
      creator: st.owedCreatorShares.toString(),
      platform: st.owedPlatformShares.toString(),
      parent: st.owedParentShares.toString(),
    },
    strategy: strategyJson(st.strategy),
    pending,
    lastRebalanceTs: Number(st.lastRebalanceTs),
    lastFeeTs: Number(st.lastFeeTs),
    chainNow: await chainNow(),
    timelockSecs: cfg.timelockSecs,
    children: children.map((c2) => ({
      pubkey: c2.pubkey,
      name: c2.name,
      symbol: c2.symbol,
      followsParent: c2.followsParent,
    })),
    ipoEvents: ipos.map((e) => {
      const data = e.data as { oldMint: string; newMint: string };
      return {
        oldSymbol: symbolOf(data.oldMint),
        newSymbol: symbolOf(data.newMint),
        ts: e.ts.toISOString(),
      };
    }),
    platformTreasury: cfg.platformTreasury,
  };
}

export type Range = "1D" | "1W" | "1M" | "ALL";
const RANGE_MS: Record<Range, number> = {
  "1D": DAY,
  "1W": 7 * DAY,
  "1M": 30 * DAY,
  ALL: 3650 * DAY,
};

export async function performance(pubkey: string, range: Range): Promise<SeriesPoint[]> {
  const d = db();
  const since = new Date(Date.now() - RANGE_MS[range]);
  const [idx, bench] = await Promise.all([
    snapshotSeries(d, pubkey, since),
    snapshotSeries(d, BENCHMARK_INDEX, since),
  ]);
  if (!idx.length) return [];
  const thin = <T>(xs: T[], max: number) =>
    xs.length <= max
      ? xs
      : xs.filter((_, i) => i % Math.ceil(xs.length / max) === 0 || i === xs.length - 1);
  const pts = thin(idx, 240);
  const base = Number(pts[0]?.sharePriceMicroUsd ?? 1);
  let bi = 0;
  let bBase: number | null = null;
  return pts.map((p) => {
    while (bi + 1 < bench.length && (bench[bi + 1]?.ts.getTime() ?? 0) <= p.ts.getTime()) bi++;
    const b = bench[bi];
    let benchmark: number | null = null;
    if (b && b.ts.getTime() <= p.ts.getTime() + 60_000) {
      bBase ??= Number(b.sharePriceMicroUsd);
      benchmark = (Number(b.sharePriceMicroUsd) / bBase) * (base / 1e6);
    }
    return {
      t: p.ts.getTime(),
      index: n6(p.sharePriceMicroUsd),
      benchmark,
      synthetic: p.synthetic,
    };
  });
}

// ---------------- activity & holders ----------------

const FEE_KINDS = ["creator", "platform", "parent royalty"];
function feeKindName(k: unknown): string {
  if (typeof k === "number") return FEE_KINDS[k] ?? "fee";
  const s = String(k ?? "").toLowerCase();
  return s === "parent" ? "parent royalty" : s || "fee";
}

/** One-line human summary of a program event (activity lists and the feed). */
export function describe(type: string, data: Record<string, unknown>): string {
  const n = (k: string) => n6(data[k] as string);
  const sym = (k: string) => symbolOf(String(data[k] ?? ""));
  switch (type) {
    case "IndexCreated":
      return data.parent
        ? `Created (clone${data.followsParent ? ", follows parent" : ""})`
        : "Created";
    case "Joined":
      return `Joined · ${n("shares").toLocaleString("en-US", { maximumFractionDigits: 2 })} shares`;
    case "Redeemed":
      return `Redeemed · ${n("shares").toLocaleString("en-US", { maximumFractionDigits: 2 })} shares`;
    case "RebalanceExecuted":
      return `Rebalanced ${sym("mintOut")} → ${sym("mintIn")} · drift ${(Number(data.driftBeforeBps) / 100).toFixed(1)}% → ${(Number(data.driftAfterBps) / 100).toFixed(1)}%`;
    case "IpoMigrated":
      return `IPO: ${sym("oldMint")} → ${sym("newMint")}`;
    case "FeesClaimed":
      return `Claimed ${feeKindName(data.kind)} fees · ${n("shares").toLocaleString("en-US", { maximumFractionDigits: 2 })} shares`;
    case "FeesAccrued":
      return "Fees accrued";
    case "IndexUpdateProposed":
      return "Update proposed";
    case "IndexUpdated":
      return "Update applied";
    case "IndexUpdateCancelled":
      return "Update cancelled";
    case "ManagersSet":
      return `Managers set (${(data.managers as unknown[] | undefined)?.length ?? 0})`;
    case "PausedSet":
      return data.paused ? "Paused" : "Unpaused";
    case "TargetsSynced":
      return "Synced targets from parent";
    default:
      return type;
  }
}

export async function activity(
  filter: { index?: string; wallet?: string },
  limit = 50,
): Promise<ActivityItem[]> {
  const d = db();
  const rows = (await activityRows(d, filter, limit)).filter(
    (r) => r.type !== "FeesAccrued" && r.type !== "ConfigUpdated",
  );
  const users = await getUsers(d, [
    ...new Set(rows.map((r) => r.wallet).filter((w): w is string => !!w)),
  ]);
  const idx = new Map((await allIndexes(d)).map((r) => [r.pubkey, r.symbol]));
  return rows.map((r) => ({
    signature: r.signature,
    type: r.type,
    ts: r.ts.toISOString(),
    wallet: r.wallet,
    handle: r.wallet ? (users.get(r.wallet)?.handle ?? null) : null,
    index: r.index,
    indexSymbol: r.index ? (idx.get(r.index) ?? null) : null,
    summary: describe(r.type, r.data as Record<string, unknown>),
  }));
}

export async function holders(pubkey: string): Promise<Holder[]> {
  const d = db();
  const rows = (await holdersOf(d, pubkey)).filter((r) => r.wallet !== pubkey);
  const total = rows.reduce((s, r) => s + Number(r.shares), 0) || 1;
  const users = await getUsers(
    d,
    rows.map((r) => r.wallet),
  );
  return rows.map((r) => ({
    wallet: r.wallet,
    handle: users.get(r.wallet)?.handle ?? null,
    shares: n6(r.shares),
    pct: Number(r.shares) / total,
  }));
}

// ---------------- leaderboard ----------------

export async function creatorsBoard(): Promise<CreatorRow[]> {
  const d = db();
  const sums = await indexSummaries();
  const byCreator = new Map<string, IndexSummary[]>();
  for (const s of sums) byCreator.set(s.creator, [...(byCreator.get(s.creator) ?? []), s]);
  const users = await getUsers(d, [...byCreator.keys()]);
  const claims = await eventsOfType(d, ["FeesClaimed"]);
  const out: CreatorRow[] = [];
  for (const [wallet, list] of byCreator) {
    const u = users.get(wallet);
    const joiners = new Set<string>();
    for (const s of list)
      for (const h of await holdersOf(d, s.pubkey))
        if (h.wallet !== wallet && h.wallet !== s.pubkey) joiners.add(h.wallet);
    const fees = claims
      // The kind decodes as an enum number (0 creator, 1 platform, 2 parent) or a name.
      .filter(
        (e) =>
          e.wallet === wallet && feeKindName((e.data as { kind: unknown }).kind) !== "platform",
      )
      .reduce((acc, e) => {
        const s = list.find((x) => x.pubkey === e.index) ?? sums.find((x) => x.pubkey === e.index);
        return acc + n6((e.data as { shares: string }).shares) * (s?.sharePrice ?? 1);
      }, 0);
    out.push({
      wallet,
      handle: u?.handle ?? null,
      isAgent: u?.isAgent ?? false,
      aumUsd: list.reduce((a, s) => a + s.navUsd, 0),
      feesUsd: fees,
      joiners: joiners.size,
      clones: list.reduce((a, s) => a + s.clones, 0),
      indexes: list.length,
      bestReturn7d: list.reduce<number | null>(
        (m, s) => (s.ret7d !== null && (m === null || s.ret7d > m) ? s.ret7d : m),
        null,
      ),
      level: levelOf(await xpOf(d, wallet)),
    });
  }
  return out.sort((a, b) => b.aumUsd - a.aumUsd);
}

// ---------------- profile & portfolio ----------------

async function positionRows(wallet: string, sums: IndexSummary[]): Promise<PositionRow[]> {
  const d = db();
  const pos = await positionsByWallet(d, wallet);
  return pos.flatMap((p) => {
    const s = sums.find((x) => x.pubkey === p.index);
    if (!s) return [];
    // An emptied vault holds no shares: a row here is the indexer catching up with a
    // full redeem, not a -100% position (it would read as a total loss for a few seconds).
    // A brand-new index has no snapshot yet (empty spark): keep its positions.
    if (s.spark.length > 0 && s.navUsd <= 0 && s.sharePrice <= 0) return [];
    const shares = n6(p.shares);
    const value = shares * s.sharePrice;
    const cost = n6(p.costBasisMicroUsd);
    return [
      {
        index: p.index,
        name: s.name,
        symbol: s.symbol,
        shares,
        valueUsd: value,
        costUsd: cost,
        pnlUsd: value - cost,
        pnlPct: cost > 0 ? value / cost - 1 : null,
        sharePrice: s.sharePrice,
        ret7d: s.ret7d,
      },
    ];
  });
}

export async function profile(wallet: string, viewer?: string): Promise<Profile> {
  const d = db();
  const u = await getUser(d, wallet);
  const sums = await indexSummaries();
  const xp = await xpOf(d, wallet);
  const level = levelOf(xp);
  const stats = await followStats(d, wallet, viewer);
  return {
    wallet,
    handle: u?.handle ?? null,
    bio: u?.bio ?? null,
    isAgent: u?.isAgent ?? false,
    agentName: u?.agentName ?? null,
    xp,
    level,
    nextLevelXp: 50 * (level + 1) ** 2,
    badges: (await badgesOf(d, wallet)).map((b) => ({
      badge: b.badge,
      awardedAt: b.awardedAt.toISOString(),
    })),
    followers: stats.followers,
    following: stats.following,
    isFollowing: stats.isFollowing,
    created: sums.filter((s) => s.creator === wallet),
    positions: await positionRows(wallet, sums),
    createdAt: u?.createdAt.toISOString() ?? null,
  };
}

export async function portfolio(wallet: string): Promise<Portfolio> {
  const c = chain();
  const sums = await indexSummaries();
  const positions = await positionRows(wallet, sums);
  const created = [];
  for (const s of sums.filter((x) => x.creator === wallet)) {
    const st = await fetchMaybeIndex(c, s.pubkey as Address);
    const owed = st ? n6(st.owedCreatorShares) : 0;
    created.push({
      ...s,
      owedCreatorShares: owed,
      owedCreatorUsd: owed * s.sharePrice,
      claimedShares: 0,
      accruing: !!st && st.fees.mgmtFeeBps > 0 && s.navUsd > 0,
    });
  }
  const parentRoyalties = [];
  for (const s of sums.filter(
    (x) => x.parent && sums.find((p) => p.pubkey === x.parent)?.creator === wallet,
  )) {
    const st = await fetchMaybeIndex(c, s.pubkey as Address);
    const owed = st ? n6(st.owedParentShares) : 0;
    parentRoyalties.push({
      index: s.pubkey,
      symbol: s.symbol,
      parent: s.parent as string,
      owedShares: owed,
      owedUsd: owed * s.sharePrice,
      accruing: !!st && st.fees.mgmtFeeBps > 0 && s.navUsd > 0,
    });
  }
  const totalUsd = positions.reduce((a, p) => a + p.valueUsd, 0);
  const costUsd = positions.reduce((a, p) => a + p.costUsd, 0);
  return {
    wallet,
    totalUsd,
    costUsd,
    pnlUsd: totalUsd - costUsd,
    positions,
    created,
    parentRoyalties,
  };
}
