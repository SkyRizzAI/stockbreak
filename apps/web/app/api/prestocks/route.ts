import { ASSETS, fetchPrestocks, PRESTOCKS_URL } from "@repo/config";
import { guard } from "@/lib/server/http";
import type { PrestocksResponse, PrestocksRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const TTL_MS = 60_000;
const RETRY_MS = 15_000;
let cache: { at: number; rows: PrestocksRow[] } | null = null;
let lastFailAt = 0;
let inflight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  try {
    const quotes = await fetchPrestocks(5000);
    const rows: PrestocksRow[] = [];
    for (const a of ASSETS) {
      if (a.issuer?.name !== "PreStocks" || !a.mainnetMint) continue;
      const q = quotes.get(a.mainnetMint);
      if (q) rows.push({ symbol: a.symbol, ...q });
    }
    cache = { at: Date.now(), rows };
  } catch (e) {
    lastFailAt = Date.now();
    console.warn("[prestocks]", e instanceof Error ? e.message : String(e));
  }
}

/** Server-side 60 s cache over the PreStocks public API; stale data is served on failure. */
export function GET() {
  return guard(async (): Promise<PrestocksResponse> => {
    const fresh = cache && Date.now() - cache.at < TTL_MS;
    if (!fresh && Date.now() - lastFailAt > RETRY_MS) {
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      await inflight;
    }
    return {
      available: !!cache,
      source: PRESTOCKS_URL,
      fetchedAt: cache ? new Date(cache.at).toISOString() : null,
      rows: cache?.rows ?? [],
    };
  });
}
