/** Tool result helpers, formatting and index resolution. */
import { parseFailure } from "@repo/sdk";
import type { Address } from "@solana/kit";
import type { McpCtx } from "./ctx";

export interface ToolResult {
  [k: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

const json = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);

/** Human summary first, then the data as JSON. */
export function ok(summary: string, data?: unknown): ToolResult {
  const text = data === undefined ? summary : `${summary}\n\n${json(data)}`;
  return { content: [{ type: "text", text }] };
}

/** Program errors become their human message (PLAN §7.6); never leaks env or secrets. */
export function toMessage(e: unknown): string {
  const f = parseFailure(e);
  if (f) return `${f.message} [${f.program}: ${f.name}]`;
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ECONNREFUSED/i.test(msg))
    return "Cannot reach the Solana RPC. Is the network running?";
  if (/insufficient (funds|lamports)/i.test(msg))
    return "Not enough SOL or tokens to complete this transaction.";
  return msg.split("\n")[0] ?? "Something went wrong";
}

export function fail(e: unknown): ToolResult {
  return { content: [{ type: "text", text: toMessage(e) }], isError: true };
}

/** Wrap a handler so thrown errors become tool errors instead of protocol errors. */
export function safe<A>(fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (e) {
      return fail(e);
    }
  };
}

export const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;
export const pct = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined ? "n/a" : `${n >= 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
export const bps = (n: number) => `${(n / 100).toFixed(2)}%`;

export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface IndexLite {
  pubkey: string;
  name: string;
  symbol: string;
}

/** Accept an index address or a symbol (case-insensitive). */
export async function resolveIndex(c: McpCtx, ref: string): Promise<IndexLite> {
  const q = ref.trim();
  if (BASE58.test(q)) {
    const d = await c.web<IndexLite>(`/api/indexes/${q}`);
    return { pubkey: d.pubkey, name: d.name, symbol: d.symbol };
  }
  // Walk every page of matches: a low-AUM index with a common symbol may sort late.
  const items: IndexLite[] = [];
  for (let page = 0; page < 20; page++) {
    const r = await c.web<{ items: IndexLite[]; total: number }>(
      `/api/indexes?q=${encodeURIComponent(q)}&limit=100&page=${page}`,
    );
    items.push(...r.items);
    if (items.length >= r.total || r.items.length === 0) break;
  }
  const exact = items.filter((i) => i.symbol.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return exact[0] as IndexLite;
  if (exact.length > 1)
    throw new Error(
      `Several indexes use the symbol ${q}: ${exact.map((i) => `${i.name} (${i.pubkey})`).join(", ")}. Pass the address instead.`,
    );
  throw new Error(`No index found for "${q}". Use list_indexes to search.`);
}

/** Symbol → mint, with a helpful error. */
export function mintFor(c: McpCtx, symbol: string): Address {
  const m = c.mintOf(symbol);
  if (!m) throw new Error(`Unknown asset ${symbol}. Use list_assets to see available symbols.`);
  return m;
}

/** Percent weights → basis points that sum to exactly 10,000. */
export function toBps(weights: { weightPct: number }[]): number[] {
  const sum = weights.reduce((a, w) => a + w.weightPct, 0);
  if (!(sum > 0)) throw new Error("Weights must be positive");
  const out = weights.map((w) => Math.round((w.weightPct / sum) * 10_000));
  const diff = 10_000 - out.reduce((a, x) => a + x, 0);
  const i = out.indexOf(Math.max(...out));
  out[i] = (out[i] ?? 0) + diff;
  if (out.some((x) => x <= 0)) throw new Error("Every weight must be above 0");
  return out;
}

export function checkUsdcLimit(c: McpCtx, usdc: number): void {
  const max = c.env.MCP_MAX_USDC_PER_ACTION;
  if (usdc > max)
    throw new Error(
      `Amount ${usd(usdc)} is above the per-action limit of ${usd(max)} (MCP_MAX_USDC_PER_ACTION).`,
    );
}
