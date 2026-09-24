/** Deterministic monochrome identicon from a seed (wallet). */
import { cn } from "cn";

function hash(s: string): number[] {
  let h = 2166136261;
  const out: number[] = [];
  for (let i = 0; i < 25; i++) {
    for (const c of `${s}:${i}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    out.push(h >>> 0);
  }
  return out;
}

export function Avatar({
  seed,
  size = 40,
  className,
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const bits = hash(seed);
  const cells: { x: number; y: number; o: number }[] = [];
  for (let y = 0; y < 5; y++)
    for (let x = 0; x < 3; x++) {
      const v = bits[y * 3 + x] ?? 0;
      if (v % 2 === 0) {
        const o = 25 + (v % 60);
        cells.push({ x, y, o });
        if (x < 2) cells.push({ x: 4 - x, y, o });
      }
    }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 5 5"
      className={cn("shrink-0 rounded-md border bg-muted", className)}
      aria-hidden
    >
      {cells.map((c) => (
        <rect
          key={`${c.x}-${c.y}`}
          x={c.x}
          y={c.y}
          width={1}
          height={1}
          style={{ fill: `color-mix(in oklch, var(--foreground) ${c.o}%, transparent)` }}
        />
      ))}
    </svg>
  );
}
