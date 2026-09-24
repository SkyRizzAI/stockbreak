/**
 * Price feeder (PLAN §7.4, A06): Jupiter → Finnhub → random walk, times the
 * manual shock factor. Re-publishes every tick so oracles never go stale.
 */
import { ASSETS } from "@repo/config";
import { readShocks } from "@repo/config/node";
import { insertPrices } from "@repo/db";
import { fetchFeeds, priceUsd, setPrices } from "@repo/sdk";
import type { Address } from "@solana/kit";
import type { WorkerCtx } from "../ctx";

const base = new Map<string, number>();
const lastLive = new Map<string, { usd: number; at: number; source: string }>();
let jupiterBackoffUntil = 0;
const finnhubAt = new Map<string, number>();

async function jupiter(c: WorkerCtx, mints: string[]): Promise<Map<string, number>> {
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
      const p = v?.stockData?.price ?? v?.usdPrice;
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
  }

  const live = c.env.PRICE_MODE === "live";
  const sources = new Map<string, string>();
  if (live) {
    const byMint = new Map<string, string>();
    for (const s of symbols) {
      const m = ASSETS.find((a) => a.symbol === s)?.mainnetMint;
      if (m) byMint.set(m, s);
    }
    const jp = await jupiter(c, [...byMint.keys()]);
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
      sources.set(s, "jupiter");
      continue;
    }
    base.set(s, walk(base.get(s) ?? 1));
    sources.set(s, "random");
  }

  const publish = symbols.map((s) => ({ symbol: s, usd: (base.get(s) ?? 1) * (shocks[s] ?? 1) }));
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
