import { ASSETS } from "@repo/config";
import * as z from "zod";
import { guard } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Mainnet USDC: logo lookup only (the simulated USDC has no mainnet mint). */
const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TTL_MS = 24 * 60 * 60_000;
const RETRY_MS = 5 * 60_000;

const Token = z.object({ id: z.string(), icon: z.string().url().optional().nullable() });

let cache: { at: number; logos: Record<string, string> } | null = null;
let lastFailAt = 0;
let inflight: Promise<void> | null = null;

/**
 * Official token logos (xStocks, PreStocks, USDC) by our symbol, read once a day from
 * Jupiter's public token list (read-only mainnet metadata, like the price feed).
 * Listed stocks created at an IPO reuse their pre-IPO company logo.
 */
async function refresh(): Promise<void> {
  try {
    const byMint = new Map<string, string>();
    for (const a of ASSETS) if (a.mainnetMint) byMint.set(a.mainnetMint, a.symbol);
    byMint.set(USDC_MAINNET, "USDC");
    const r = await fetch(
      `https://lite-api.jup.ag/tokens/v2/search?query=${[...byMint.keys()].join(",")}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!r.ok) throw new Error(`Jupiter tokens HTTP ${r.status}`);
    const logos: Record<string, string> = {};
    for (const row of z.array(z.unknown()).parse(await r.json())) {
      const t = Token.safeParse(row);
      const sym = t.success ? byMint.get(t.data.id) : undefined;
      if (t.success && sym && t.data.icon?.startsWith("https://")) logos[sym] = t.data.icon;
    }
    for (const a of ASSETS) {
      const pre = ASSETS.find((p) => p.ipoTarget === a.symbol);
      if (!logos[a.symbol] && pre && logos[pre.symbol])
        logos[a.symbol] = logos[pre.symbol] as string;
    }
    cache = { at: Date.now(), logos };
  } catch (e) {
    lastFailAt = Date.now();
    console.warn("[token-logos]", e instanceof Error ? e.message : String(e));
  }
}

export function GET() {
  return guard(async () => {
    const fresh = cache && Date.now() - cache.at < TTL_MS;
    if (!fresh && Date.now() - lastFailAt > RETRY_MS) {
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      await inflight;
    }
    return { logos: cache?.logos ?? {} };
  });
}
