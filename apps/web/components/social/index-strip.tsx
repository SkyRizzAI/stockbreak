"use client";
/** Compact composition of an index: token logos with weights over the allocation bar. */
import Link from "next/link";
import { AllocationBar } from "@/components/data/allocation";
import { TickerMono } from "@/components/data/glyph";
import type { AssetRow, IndexSummary } from "@/lib/types";

export function TokenWeights({ assets }: { assets: AssetRow[] }) {
  const total = assets.reduce((a, x) => a + x.targetWeightBps, 0) || 1;
  const held = assets.filter((a) => a.targetWeightBps > 0);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Tokens in this index">
        {held.map((a) => (
          <li key={a.mint} className="inline-flex items-center gap-1.5 text-xs">
            <TickerMono symbol={a.symbol} size={18} />
            <span className="mono">{a.symbol}</span>
            <span className="num text-muted-foreground">
              {((a.targetWeightBps / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
      <AllocationBar
        slices={held.map((a) => ({ label: a.symbol, weightBps: a.targetWeightBps }))}
        height={6}
      />
    </div>
  );
}

/** An index attached to a feed post. */
export function IndexStrip({ index }: { index: IndexSummary }) {
  return (
    <Link
      href={`/i/${index.pubkey}`}
      className="mt-3 flex flex-col gap-3 rounded-xl border p-3 transition-colors hover:bg-raised"
      data-testid="index-strip"
    >
      <span className="flex items-baseline gap-2">
        <span className="truncate text-sm font-semibold">{index.name}</span>
        <span className="mono text-xs text-muted-foreground">{index.symbol}</span>
      </span>
      <TokenWeights assets={index.assets} />
    </Link>
  );
}
