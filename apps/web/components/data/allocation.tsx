import { cn } from "cn";

export interface Slice {
  label: string;
  weightBps: number;
}

const shade = (i: number, n: number) => 85 - Math.round((i / Math.max(n - 1, 1)) * 60);

/** Horizontal stacked allocation bar (§8.3: bars, not pie). */
export function AllocationBar({
  slices,
  className,
  height = 8,
}: {
  slices: Slice[];
  className?: string;
  height?: number;
}) {
  const total = slices.reduce((a, s) => a + s.weightBps, 0) || 1;
  return (
    <div
      className={cn("flex w-full overflow-hidden rounded-full bg-muted", className)}
      style={{ height }}
      role="img"
      aria-label="Allocation"
    >
      {slices.map((s, i) => (
        <div
          key={s.label}
          title={`${s.label} ${(s.weightBps / 100).toFixed(1)}%`}
          style={{
            width: `${(s.weightBps / total) * 100}%`,
            background: `color-mix(in oklch, var(--foreground) ${shade(i, slices.length)}%, var(--background))`,
          }}
          className="h-full border-r border-background last:border-r-0"
        />
      ))}
    </div>
  );
}

export function AllocationLegend({ slices }: { slices: Slice[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {slices.map((s, i) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <span
            className="size-2 rounded-sm"
            style={{
              background: `color-mix(in oklch, var(--foreground) ${shade(i, slices.length)}%, var(--background))`,
            }}
          />
          <span className="num">{s.label}</span>
          <span className="num text-foreground">{(s.weightBps / 100).toFixed(1)}%</span>
        </span>
      ))}
    </div>
  );
}
