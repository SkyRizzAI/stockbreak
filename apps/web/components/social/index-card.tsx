"use client";
/**
 * Shareable index card (D035): header look from the index's own data
 * (mark | tokens | chart), the token collection with weights, 30-day return,
 * TVL and drawdown next to SPYx. Green family only (D034), no illustrations.
 */
import { cn } from "cn";
import Link from "next/link";
import { IndexGlyph, MARKS, TickerMono } from "@/components/data/glyph";
import { Delta, Usd } from "@/components/data/num";
import { Sparkline } from "@/components/data/sparkline";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useBenchmark } from "@/lib/api";
import { maxDrawdown, pct, short } from "@/lib/format";
import { CARD_VARIANTS, type CardVariant, type IndexSummary } from "@/lib/types";

const LABEL: Record<CardVariant, string> = { mark: "Mark", tokens: "Tokens", chart: "Chart" };
/** Readable text on each mark tone; theme-aware (the light theme reverses the ramp). */
const INK = [
  "text-[var(--mark-ink-1)]",
  "text-[var(--mark-ink-2)]",
  "text-[var(--mark-ink-3)]",
  "text-[var(--mark-ink-4)]",
];

function weights(index: IndexSummary) {
  const total = index.assets.reduce((a, x) => a + x.targetWeightBps, 0) || 1;
  return index.assets
    .filter((a) => a.targetWeightBps > 0)
    .map((a, i) => ({ ...a, share: a.targetWeightBps / total, tone: i % MARKS.length }));
}

/** Big stripes: the index mark as a banner, one column per asset sized by weight. */
function MarkHeader({ index }: { index: IndexSummary }) {
  const ws = weights(index);
  return (
    <div className="flex h-full gap-1.5 p-4">
      {ws.map((a) => (
        <div
          key={a.mint}
          className="flex h-full min-w-2 items-end rounded-md p-2"
          style={{ flexGrow: a.share, flexBasis: 0, background: MARKS[a.tone] }}
        >
          {a.share >= 0.14 ? (
            <span className={cn("mono text-[11px] font-medium", INK[a.tone])}>{a.symbol}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Token tiles: each holding as a tile whose area follows its weight. */
function TokensHeader({ index }: { index: IndexSummary }) {
  const ws = weights(index);
  return (
    <div className="flex h-full flex-wrap content-stretch gap-1.5 p-4">
      {ws.map((a) => (
        <div
          key={a.mint}
          className="flex min-w-16 flex-col justify-between rounded-md p-2.5"
          style={{
            flexGrow: a.share * 10,
            flexBasis: `${Math.max(16, a.share * 100 - 4)}%`,
            background: MARKS[a.tone],
          }}
        >
          <span className={cn("mono text-xs font-medium", INK[a.tone])}>{a.symbol}</span>
          <span className={cn("num text-lg leading-none font-bold", INK[a.tone])}>
            {(a.share * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/** Performance: the 30-day curve full bleed with the return on top. */
function ChartHeader({ index }: { index: IndexSummary }) {
  const data = index.spark;
  const up = (data.at(-1) ?? 0) >= (data[0] ?? 0);
  const tone = up ? "var(--up)" : "var(--down)";
  let path = "";
  let area = "";
  if (data.length >= 2) {
    const min = Math.min(...data);
    const span = Math.max(...data) - min || 1;
    const pts = data.map((v, i) => [(i / (data.length - 1)) * 100, 36 - ((v - min) / span) * 28]);
    path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
    area = `${path} L100,40 L0,40 Z`;
  }
  return (
    <div className="relative h-full">
      <div className="absolute top-4 left-4 flex flex-col gap-0.5">
        <span className="text-xs text-muted-foreground">30D return</span>
        <Delta value={index.ret30d} className="text-3xl leading-none font-bold" />
      </div>
      {path ? (
        <svg
          viewBox="0 0 100 40"
          preserveAspectRatio="none"
          className="absolute inset-x-0 bottom-0 h-2/3 w-full"
          aria-hidden
        >
          <path d={area} style={{ fill: tone, opacity: 0.12 }} />
          <path
            d={path}
            fill="none"
            style={{ stroke: tone }}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </div>
  );
}

export function IndexCard({
  index,
  variant,
  className,
}: {
  index: IndexSummary;
  variant: CardVariant;
  className?: string;
}) {
  const bench = useBenchmark();
  const dd = maxDrawdown(index.spark);
  const benchDd = bench.data ? maxDrawdown(bench.data.spark) : null;
  const ws = weights(index);
  return (
    <article
      className={cn("overflow-hidden rounded-2xl border bg-surface", className)}
      data-testid="index-card"
      data-variant={variant}
    >
      <Link href={`/i/${index.pubkey}`} className="block" aria-label={`Open ${index.name}`}>
        <div className="h-36 border-b bg-raised">
          {variant === "mark" ? (
            <MarkHeader index={index} />
          ) : variant === "tokens" ? (
            <TokensHeader index={index} />
          ) : (
            <ChartHeader index={index} />
          )}
        </div>
      </Link>
      <div className="flex flex-col gap-4 p-4 md:p-5">
        <div className="flex items-start gap-3">
          <IndexGlyph
            pubkey={index.pubkey}
            weights={index.assets.map((a) => a.targetWeightBps)}
            size={40}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <Link href={`/i/${index.pubkey}`} className="flex items-baseline gap-2 hover:underline">
              <span className="truncate text-lg font-bold">{index.name}</span>
              <span className="mono text-xs text-muted-foreground">{index.symbol}</span>
            </Link>
            <span className="text-[13px] text-muted-foreground">
              by{" "}
              <Link href={`/u/${index.creator}`} className="text-foreground hover:underline">
                {index.creatorHandle ? (
                  `@${index.creatorHandle}`
                ) : (
                  <span className="mono">{short(index.creator)}</span>
                )}
              </Link>
              {index.creatorIsAgent ? " · AI" : ""}
              {index.hasPreIpo ? " · Pre-IPO (PreStocks)" : ""}
            </span>
          </div>
        </div>
        {index.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{index.description}</p>
        ) : null}

        <ul className="flex flex-wrap gap-1.5" aria-label="Tokens in this index">
          {ws.map((a) => (
            <li
              key={a.mint}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm border bg-background px-2 text-xs"
            >
              <TickerMono symbol={a.symbol} size={16} />
              <span className="mono">{a.symbol}</span>
              <span className="num text-muted-foreground">{(a.share * 100).toFixed(0)}%</span>
            </li>
          ))}
        </ul>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-hairline pt-4 sm:grid-cols-4">
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">30D return</dt>
            <dd className="flex items-center gap-2">
              <Delta value={index.ret30d} className="text-base font-semibold" />
              {variant !== "chart" ? <Sparkline data={index.spark} width={56} height={20} /> : null}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">TVL</dt>
            <dd>
              {/* No snapshot yet (index created moments ago): unknown, not $0. */}
              {index.spark.length === 0 && index.navUsd <= 0 ? (
                <span className="num text-base font-semibold text-muted-foreground">—</span>
              ) : (
                <Usd value={index.navUsd} compact className="text-base font-semibold" />
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">Max drawdown 30D</dt>
            <dd className="num text-base font-semibold">
              {dd === null ? "—" : pct(-dd, 2, false)}
            </dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-muted-foreground">SPYx drawdown</dt>
            <dd className="num text-base text-muted-foreground">
              {benchDd === null ? "—" : pct(-benchDd, 2, false)}
            </dd>
          </div>
        </dl>
      </div>
    </article>
  );
}

export function CardVariantPicker({
  value,
  onChange,
}: {
  value: CardVariant;
  onChange: (v: CardVariant) => void;
}) {
  return (
    <ToggleGroup
      value={[value]}
      onValueChange={(v) => (v as string[])[0] && onChange((v as string[])[0] as CardVariant)}
      variant="outline"
      size="sm"
      aria-label="Card style"
    >
      {CARD_VARIANTS.map((v) => (
        <ToggleGroupItem key={v} value={v} className="px-3" data-testid={`card-variant-${v}`}>
          {LABEL[v]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
