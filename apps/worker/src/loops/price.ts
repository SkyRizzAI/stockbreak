/**
 * Price feeder (PLAN §7.4, A06, D037): pre-IPO assets read the PreStocks API first
 * (token price), then Jupiter; stocks use Jupiter → Finnhub; everything else random-walks.
 * Times the manual shock factor. Re-publishes every tick so oracles never go stale.
 * All external sources are read-only mainnet data.
 */
import { ASSETS, fetchPrestocks } from "@repo/config";
import { readShocks } from "@repo/config/node";
import { insertPrices } from "@repo/db";
import { fetchFeeds, priceUsd, setPrices } from "@repo/sdk";
import type { Address } from "@solana/kit";
import type { WorkerCtx } from "../ctx";

const base = new Map<string, number>();
const lastLive = new Map<string, { usd: number; at: number; source: string }>();
let jupiterBackoffUntil = 0;
let prestocksBackoffUntil = 0;
const lastSourceLog = new Map<string, string>();
/** Last published un-shocked price per symbol (for the per-tick step cap). */
const published = new Map<string, number>();
/**
 * A live source may move the oracle at most this much per tick. Real prices rarely do;
 * a source switch (PreStocks token vs Jupiter mark ≈ 20% apart) or an IPO target getting
 * its own feed would otherwise jump NAVs at once and trigger rebalances on noise.
 * Manual shocks (`bun run price`) are applied on top and stay instant.
 */
const MAX_STEP = 0.05;

/** PreStocks token prices by mainnet mint. Never throws. */
async function prestocks(c: WorkerCtx): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (Date.now() < prestocksBackoffUntil) return out;
  try {
    for (const [mint, q] of await fetchPrestocks(8000)) out.set(mint, q.tokenPrice);
  } catch (e) {
    prestocksBackoffUntil = Date.now() + 30_000;
    c.log("price", `PreStocks API unavailable, falling back: ${(e as Error).message}`);
  }
  return out;
}
const finnhubAt = new Map<string, number>();

/**
 * Jupiter Price v3. `tokenOnly` mints use the token's own trading price (`usdPrice`), as the
 * PreStocks source does; others prefer the underlying stock price (`stockData.price`).
 */
async function jupiter(
  c: WorkerCtx,
  mints: string[],
  tokenOnly: ReadonlySet<string> = new Set(),
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!mints.length || Date.now() < jupiterBackoffUntil) return out;
  const headers: Record<string, string> = {};
  if (c.env.JUPITER_API_KEY) headers["x-api-key"] = c.env.JUPITER_API_KEY;
  try {
    const r = await fetch(`https://api.jup.ag/price/v3?ids=${mints.join(",")}`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 429) {
      jupiterBackoffUntil = Date.now() + 60_000;
      return out;
    }
    if (!r.ok) return out;
    const j = (await r.json()) as Record<
      string,
      { usdPrice?: number; stockData?: { price?: number } } | null
    >;
    for (const [mint, v] of Object.entries(j)) {
      const p = tokenOnly.has(mint) ? v?.usdPrice : (v?.stockData?.price ?? v?.usdPrice);
      if (typeof p === "number" && p > 0) out.set(mint, p);
    }
  } catch {
    jupiterBackoffUntil = Date.now() + 30_000;
  }
  return out;
}

async function finnhub(c: WorkerCtx, ticker: string): Promise<number | null> {
  if (!c.env.FINNHUB_API_KEY) return null;
  const last = finnhubAt.get(ticker) ?? 0;
  if (Date.now() - last < 60_000) return null;
  finnhubAt.set(ticker, Date.now());
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${c.env.FINNHUB_API_KEY}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { c?: number };
    return j.c && j.c > 0 ? j.c : null;
  } catch {
    return null;
  }
}

/** Gaussian-ish step, ±~0.2% per tick. */
function walk(p: number): number {
  const u = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  return p * (1 + u * 0.002);
}

export async function priceTick(c: WorkerCtx): Promise<void> {
  const d = c.deployment();
  const shocks = readShocks(c.env.CLUSTER);
  const onchain = await fetchFeeds(c, Object.values(d.feeds) as Address[]);
  // Feeds created later (e.g. an IPO target before its IPO event) are skipped until they exist.
  const symbols = Object.keys(d.feeds).filter((s) => onchain.has(d.feeds[s] as Address));

  // Initialise base prices from chain (un-shocked).
  for (const s of symbols) {
    if (base.has(s)) continue;
    const f = onchain.get(d.feeds[s] as Address);
    const def = ASSETS.find((a) => a.symbol === s);
    const chainUsd = f && f.price > 0n ? priceUsd(f) : (def?.fixturePrice ?? 1);
    base.set(s, chainUsd / (shocks[s] ?? 1));
    published.set(s, chainUsd / (shocks[s] ?? 1));
  }

  const live = c.env.PRICE_MODE === "live";
  const sources = new Map<string, string>();
  if (live) {
    const byMint = new Map<string, string>();
    for (const s of symbols) {
      const m = ASSETS.find((a) => a.symbol === s)?.mainnetMint;
      if (m) byMint.set(m, s);
    }
    // Pre-IPO: PreStocks API is the primary source (matched by mainnet mint).
    const preMints = [...byMint].filter(
      ([, s]) => ASSETS.find((a) => a.symbol === s)?.priceSource === "prestocks",
    );
    if (preMints.length) {
      const ps = await prestocks(c);
      for (const [mint, s] of preMints) {
        const usd = ps.get(mint);
        if (!usd) continue;
        base.set(s, usd);
        lastLive.set(s, { usd, at: Date.now(), source: "prestocks" });
        sources.set(s, "prestocks");
      }
    }
    const jpMints = [...byMint].filter(([, s]) => !sources.has(s)).map(([m]) => m);
    const jp = await jupiter(c, jpMints, new Set(preMints.map(([m]) => m)));
    for (const [mint, usd] of jp) {
      const s = byMint.get(mint) as string;
      base.set(s, usd);
      lastLive.set(s, { usd, at: Date.now(), source: "jupiter" });
      sources.set(s, "jupiter");
    }
    for (const s of symbols) {
      if (sources.has(s)) continue;
      const def = ASSETS.find((a) => a.symbol === s);
      if (def?.kind === "Stock" && def.ticker && def.mainnetMint) {
        const f = await finnhub(c, def.ticker);
        if (f) {
          base.set(s, f);
          sources.set(s, "finnhub");
        }
      }
    }
  }
  // IPO targets without a live source follow their pre-IPO asset; others random-walk.
  for (const s of symbols) {
    if (s === "USDC") {
      base.set(s, 1);
      sources.set(s, "fixture");
      continue;
    }
    if (sources.has(s)) continue;
    const pre = ASSETS.find((a) => a.ipoTarget === s);
    const liveOfPre = pre ? lastLive.get(pre.symbol) : undefined;
    if (liveOfPre && Date.now() - liveOfPre.at < 120_000) {
      base.set(s, liveOfPre.usd);
      sources.set(s, `follows:${pre?.symbol}`);
      continue;
    }
    base.set(s, walk(base.get(s) ?? 1));
    sources.set(s, "random");
  }

  // Log the source per asset whenever it changes (keeps logs quiet at steady state).
  const changed = symbols.filter((s) => lastSourceLog.get(s) !== sources.get(s));
  if (changed.length) {
    for (const s of changed) lastSourceLog.set(s, sources.get(s) ?? "random");
    c.log("price", `sources: ${changed.map((s) => `${s}=${sources.get(s)}`).join(" ")}`);
  }

  for (const s of symbols) {
    const target = base.get(s) ?? 1;
    const prev = published.get(s);
    const eased =
      prev && s !== "USDC"
        ? Math.min(prev * (1 + MAX_STEP), Math.max(prev * (1 - MAX_STEP), target))
        : target;
    if (eased !== target && lastSourceLog.get(`${s}:easing`) !== "1") {
      lastSourceLog.set(`${s}:easing`, "1");
      c.log("price", `${s}: easing ${prev?.toFixed(2)} → ${target.toFixed(2)} (max 5%/tick)`);
    } else if (eased === target) lastSourceLog.delete(`${s}:easing`);
    published.set(s, eased);
  }
  const publish = symbols.map((s) => ({
    symbol: s,
    usd: (published.get(s) ?? 1) * (shocks[s] ?? 1),
  }));
  await setPrices(
    c,
    c.admin,
    publish.map((p) => ({ feed: d.feeds[p.symbol] as Address, usd: p.usd })),
  );
  const ts = new Date();
  await insertPrices(
    c.db,
    publish.map((p) => ({
      symbol: p.symbol,
      ts,
      priceMicroUsd: BigInt(Math.round(p.usd * 1e6)),
      source: sources.get(p.symbol) ?? "random",
      synthetic: false,
    })),
  );
}
