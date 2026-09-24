/**
 * Deterministic index identity (§8.3): a tiny weight bar derived from the
 * pubkey + composition. Monochrome shades only.
 */
import { cn } from "cn";

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

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
  const h = hash(pubkey);
  const rot = h % 4;
  let x = 0;
  const bars = weights.map((w, i) => {
    const width = (w / total) * size;
    const shade = 20 + ((((h >> (i * 3)) & 7) * 8 + i * 13) % 60);
    const r = { x, width, shade };
    x += width;
    return r;
  });
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0 rounded-md border", className)}
      aria-hidden
      style={{ transform: `rotate(${rot * 90}deg)` }}
    >
      {bars.map((b, i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: static order
          key={i}
          x={b.x}
          y={0}
          width={Math.max(b.width - 0.5, 0.5)}
          height={size}
          style={{ fill: `color-mix(in oklch, var(--foreground) ${b.shade}%, var(--background))` }}
        />
      ))}
    </svg>
  );
}

export function TickerMono({ symbol, className }: { symbol: string; className?: string }) {
  const label = symbol
    .replace(/x$|-pre$/i, "")
    .slice(0, 4)
    .toUpperCase();
  return (
    <span
      className={cn(
        "num inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded border bg-muted px-1 text-[10px] font-medium text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      {label}
    </span>
  );
}
