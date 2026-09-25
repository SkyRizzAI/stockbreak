/**
 * PreStocks public API (read-only, no key). Used as the primary price source for
 * pre-IPO assets (D037). Matched to our assets by mainnet mint (`contract_address`).
 * Never used to send transactions.
 */
import * as z from "zod";

export const PRESTOCKS_URL = "https://prestocks.com";
export const PRESTOCKS_API_URL = "https://prestocks.com/api/prestocks";

/** Real SpaceX PreStocks → SPCXx conversion deadline (ISO, UTC). */
export const SPACEX_SWAP_DEADLINE = "2027-03-12T23:59:00Z";

const finite = z.number().finite();

export const PrestocksTokenSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  external_url: z.string().optional(),
  contract_address: z.string().min(32),
  /** Reference (SPV mark) price per token, USD. */
  markPrice: finite.positive().nullish(),
  markValuation: finite.nonnegative().optional(),
  /** On-chain trading price per token, USD. */
  tokenPrice: finite.positive(),
  impliedValuation: finite.nonnegative().nullish(),
  supply: finite.nonnegative().optional(),
});
export type PrestocksToken = z.infer<typeof PrestocksTokenSchema>;

export interface PrestocksQuote {
  mint: string;
  prestocksSymbol: string;
  url: string;
  tokenPrice: number;
  /** Display only; null when PreStocks omits it (the oracle only needs tokenPrice). */
  markPrice: number | null;
  impliedValuation: number | null;
  markValuation: number | null;
  supply: number | null;
  /** tokenPrice / markPrice - 1 (positive = premium to mark). */
  premium: number | null;
}

/** Parse the API payload; invalid rows are skipped, a non-array payload throws. */
export function parsePrestocks(payload: unknown): Map<string, PrestocksQuote> {
  const rows = z.array(z.unknown()).parse(payload);
  const out = new Map<string, PrestocksQuote>();
  for (const row of rows) {
    const r = PrestocksTokenSchema.safeParse(row);
    if (!r.success) continue;
    const t = r.data;
    out.set(t.contract_address, {
      mint: t.contract_address,
      prestocksSymbol: t.symbol,
      url: t.external_url ?? PRESTOCKS_URL,
      tokenPrice: t.tokenPrice,
      markPrice: t.markPrice ?? null,
      impliedValuation: t.impliedValuation ?? null,
      markValuation: t.markValuation ?? null,
      supply: t.supply ?? null,
      premium: t.markPrice ? t.tokenPrice / t.markPrice - 1 : null,
    });
  }
  return out;
}

/** Fetch + validate. Throws on network/HTTP/shape errors; callers must fall back. */
export async function fetchPrestocks(timeoutMs = 8000): Promise<Map<string, PrestocksQuote>> {
  const r = await fetch(PRESTOCKS_API_URL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`PreStocks API HTTP ${r.status}`);
  return parsePrestocks(await r.json());
}
