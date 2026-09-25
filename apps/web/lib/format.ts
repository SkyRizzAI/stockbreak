/** Display formatting. Money is micro-USD bigint (1e6 = $1); shares have 6 decimals. */

export const toNumber = (v: bigint | string | number | null | undefined, decimals = 6): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "bigint" ? v : BigInt(typeof v === "number" ? Math.round(v) : v || "0");
  return Number(n) / 10 ** decimals;
};

export function usd(v: number, opts: { compact?: boolean; digits?: number } = {}): string {
  if (!Number.isFinite(v)) return "—";
  if (opts.compact && Math.abs(v) >= 10_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(v);
  }
  const digits = opts.digits ?? (Math.abs(v) >= 1000 ? 0 : 2);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

export function price(v: number): string {
  if (!Number.isFinite(v) || v === 0) return "—";
  const digits = v >= 1000 ? 2 : v >= 1 ? 2 : 4;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

export function num(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(v);
}

export function pct(v: number | null | undefined, digits = 2, signed = true): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(digits);
  return `${signed && v > 0 ? "+" : ""}${s}%`;
}

export const bps = (b: number, digits = 1) => {
  const t = (b / 100).toFixed(digits).replace(/\.0$/, "");
  // Tiny negatives round to "-0": show a plain 0.
  return `${Number(t) === 0 ? "0" : t}%`;
};

export const short = (addr: string, n = 4) =>
  addr.length > 2 * n + 1 ? `${addr.slice(0, n)}…${addr.slice(-n)}` : addr;

export function ago(ts: string | number | Date): string {
  const d = typeof ts === "string" || typeof ts === "number" ? new Date(ts) : ts;
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function duration(secs: number): string {
  if (secs <= 0) return "0s";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Parse a user-entered decimal into raw units. */
export function toRaw(input: string, decimals: number): bigint | null {
  const t = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return null;
  const [i = "0", f = ""] = t.split(".");
  return (
    BigInt(i || "0") * 10n ** BigInt(decimals) +
    BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0")
  );
}

/** Largest peak-to-trough fall of a price series, as a fraction (0.12 = 12%). */
export function maxDrawdown(series: readonly number[]): number | null {
  if (series.length < 2) return null;
  let peak = series[0] as number;
  let worst = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.max(worst, (peak - v) / peak);
  }
  return worst;
}
