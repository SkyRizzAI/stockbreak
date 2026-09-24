"use client";
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePerformance } from "@/lib/api";
import { price } from "@/lib/format";

const config = {
  index: { label: "Share price", color: "var(--foreground)" },
  benchmark: { label: "SPYx", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

export const RANGES = ["1D", "1W", "1M", "ALL"] as const;

function fmtTime(t: number, range: string) {
  const d = new Date(t);
  return range === "1D"
    ? d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PerfChart({
  pubkey,
  range,
  onRange,
  showBench,
  onBench,
  live,
  symbol,
}: {
  pubkey: string;
  /** Ticker shown in the legend. */
  symbol: string;
  range: string;
  onRange: (r: string) => void;
  showBench: boolean;
  onBench: (b: boolean) => void;
  /** Live share price; appended as the latest point so the line ends at the shown price. */
  live?: number;
}) {
  const q = usePerformance(pubkey, range);
  const snaps = q.data ?? [];
  const last = snaps.at(-1);
  const data =
    last && live && live > 0 && Date.now() - last.t > 30_000
      ? [...snaps, { t: Date.now(), index: live, benchmark: last.benchmark, synthetic: false }]
      : snaps;
  const synthetic = data.some((d) => d.synthetic);
  const up = data.length > 1 ? (data.at(-1)?.index ?? 0) >= (data[0]?.index ?? 0) : true;
  const tone = up ? "var(--up)" : "var(--down)";
  // Enough decimals that neighbouring axis labels differ on flat series.
  const vals = data.flatMap((d) => [
    d.index,
    ...(showBench && d.benchmark !== null ? [d.benchmark] : []),
  ]);
  const span = vals.length ? Math.max(...vals) - Math.min(...vals) : 1;
  const axisDigits = span < 0.02 ? 4 : span < 0.2 ? 3 : 2;
  // Up to 6 ticks with distinct labels (intraday points share a date label).
  const ticks: number[] = [];
  const seen = new Set<string>();
  const step = Math.max(1, Math.floor(data.length / 6));
  for (let i = 0; i < data.length; i += step) {
    const p = data[i];
    if (!p) continue;
    const l = fmtTime(p.t, range);
    if (!seen.has(l)) {
      seen.add(l);
      ticks.push(p.t);
    }
  }
  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-surface p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-bold tracking-tight">
            {showBench ? "Is it beating SPYx?" : "Share price"}
          </h2>
          <span className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full" style={{ background: tone }} aria-hidden />
              <span className="mono">{symbol}</span>
            </span>
            {showBench ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 border-t border-dashed border-muted-foreground" aria-hidden />
                <span className="mono">SPYx</span>
              </span>
            ) : null}
            {synthetic ? <span>Includes simulated history</span> : null}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="bench" className="text-xs text-muted-foreground">
            vs SPYx
          </Label>
          <Switch id="bench" checked={showBench} onCheckedChange={onBench} size="sm" />
          <ToggleGroup
            value={[range]}
            onValueChange={(v) => (v as string[])[0] && onRange((v as string[])[0] as string)}
            size="sm"
            variant="outline"
            aria-label="Range"
          >
            {RANGES.map((r) => (
              <ToggleGroupItem key={r} value={r} className="px-2.5">
                {r}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : data.length < 2 ? (
        <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed text-sm text-muted-foreground">
          Not enough history yet. Snapshots are taken every minute.
        </div>
      ) : (
        <ChartContainer config={config} className="h-64 w-full">
          <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={tone} stopOpacity={0.12} />
                <stop offset="100%" stopColor={tone} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="0" stroke="var(--border)" />
            <XAxis
              dataKey="t"
              ticks={ticks}
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              tickFormatter={(t) => fmtTime(Number(t), range)}
              className="text-[11px]"
            />
            <YAxis
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={60}
              domain={["auto", "auto"]}
              tickFormatter={(v) => `$${Number(v).toFixed(axisDigits)}`}
              className="num text-[11px]"
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload as {
                  t: number;
                  index: number;
                  benchmark: number | null;
                  synthetic: boolean;
                };
                return (
                  <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
                    <div className="text-muted-foreground">
                      {new Date(p.t).toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: range === "1D" ? "short" : undefined,
                      })}
                    </div>
                    <div className="num">{price(p.index)}</div>
                    {showBench && p.benchmark !== null ? (
                      <div className="num text-muted-foreground">SPYx {price(p.benchmark)}</div>
                    ) : null}
                    {p.synthetic ? (
                      <div className="text-muted-foreground">Simulated history</div>
                    ) : null}
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="index"
              stroke={tone}
              strokeWidth={1.5}
              fill="url(#fill)"
              isAnimationActive={false}
              dot={false}
            />
            {showBench ? (
              <Line
                type="monotone"
                dataKey="benchmark"
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                strokeWidth={1.25}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ) : null}
          </ComposedChart>
        </ChartContainer>
      )}
    </section>
  );
}
