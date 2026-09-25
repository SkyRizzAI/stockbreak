"use client";
/**
 * Deterministic index identity (§8.3, refs \"Index mark\"): stripes sized by
 * weight in the four greens.
 */
import { cn } from "cn";
import { useState } from "react";
import { useTokenLogos } from "@/lib/api";

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Stripe colours: the four greens (refs "Index mark"), cycled per asset. */
export const MARKS = ["var(--mark-1)", "var(--mark-2)", "var(--mark-3)", "var(--mark-4)"];

/** Index mark: one stripe per asset, sized by weight, in the four greens. */
export function IndexGlyph({
  pubkey,
  weights,
  size = 32,
  className,
}: {
  pubkey: string;
  weights: number[];
  size?: number;
  className?: string;
}) {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  // Orientation varies per index so neighbouring marks read differently.
  const vertical = hash(pubkey) % 2 === 0;
  const pad = Math.max(3, Math.round(size / 10));
  const gap = size >= 28 ? 2 : 1;
  const inner = size - pad * 2 - gap * Math.max(weights.length - 1, 0);
  let at = pad;
  const bars = weights.map((w, i) => {
    const len = Math.max(1.5, (w / total) * inner);
    const r = { at, len, fill: MARKS[i % MARKS.length] };
    at += len + gap;
    return r;
  });
  const inside = size - pad * 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0 rounded-md bg-raised", className)}
      aria-hidden
    >
      {bars.map((b, i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: static order
          key={i}
          x={vertical ? b.at : pad}
          y={vertical ? pad : b.at}
          width={vertical ? b.len : inside}
          height={vertical ? inside : b.len}
          rx={1.5}
          style={{ fill: b.fill }}
        />
      ))}
    </svg>
  );
}

/**
 * An asset's official token logo (xStocks / PreStocks / USDC, from /api/token-logos),
 * falling back to a mono ticker tile when offline or the image fails.
 */
export function TickerMono({
  symbol,
  className,
  size = 24,
}: {
  symbol: string;
  className?: string;
  size?: number;
}) {
  const url = useTokenLogos().data?.logos[symbol];
  const [broken, setBroken] = useState(false);
  if (url && !broken)
    return (
      // biome-ignore lint/performance/noImgElement: remote issuer logos, tiny and cached
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setBroken(true)}
        className={cn(
          "shrink-0 rounded-full bg-surface object-cover ring-1 ring-border",
          className,
        )}
        style={{ width: size, height: size }}
      />
    );
  const label = symbol
    .replace(/x$|-pre$/i, "")
    .slice(0, 4)
    .toUpperCase();
  return (
    <span
      className={cn(
        "mono inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded-sm border bg-surface px-1 text-[10px] font-medium text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      {label}
    </span>
  );
}

/** Overlapping token logos (Raydium-style pair icons) for an index's holdings. */
export function AssetStack({
  symbols,
  size = 20,
  max = 4,
  className,
}: {
  symbols: string[];
  size?: number;
  max?: number;
  className?: string;
}) {
  const shown = symbols.slice(0, max);
  const rest = symbols.length - shown.length;
  return (
    <span
      role="img"
      className={cn("inline-flex items-center", className)}
      aria-label={symbols.join(", ")}
    >
      {shown.map((s, i) => (
        <span
          key={s}
          className="rounded-full ring-2 ring-background"
          style={{ marginLeft: i ? -size / 3 : 0, zIndex: shown.length - i }}
        >
          <TickerMono symbol={s} size={size} className="min-w-0" />
        </span>
      ))}
      {rest > 0 ? (
        <span className="num ml-1 text-[11px] text-muted-foreground">+{rest}</span>
      ) : null}
    </span>
  );
}
