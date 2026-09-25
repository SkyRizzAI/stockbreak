"use client";
import Link from "next/link";
import { useState } from "react";
import { UserLink } from "@/components/data/addr";
import { IndexGlyph } from "@/components/data/glyph";
import { Delta, Usd } from "@/components/data/num";
import { Sparkline } from "@/components/data/sparkline";
import { EmptyState, ErrorState, RowsSkeleton, SimulatedBadge } from "@/components/data/states";
import { IndexTable } from "@/components/index/index-table";
import { TokenWeights } from "@/components/social/index-strip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCreatorsBoard, useIndexBoard } from "@/lib/api";
import { pct, short } from "@/lib/format";
import type { IndexSummary } from "@/lib/types";

const RANGES = [
  { v: "24h", k: "ret24h" },
  { v: "7d", k: "ret7d" },
  { v: "30d", k: "ret30d" },
  { v: "all", k: "retAll" },
] as const;

function Podium({
  rows,
  k,
  benchmark,
}: {
  rows: IndexSummary[];
  k: (typeof RANGES)[number]["k"];
  benchmark: number | null;
}) {
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {rows.slice(0, 3).map((r, i) => {
        const ret = r[k];
        const vs = ret !== null && benchmark !== null ? (ret - benchmark) * 100 : null;
        return (
          <li key={r.pubkey}>
            <Link
              href={`/i/${r.pubkey}`}
              className="flex h-full flex-col gap-4 rounded-2xl border bg-surface p-6 transition-colors hover:border-ring/40"
            >
              <span className="flex items-center justify-between text-sm">
                <span className="font-semibold">No. {i + 1}</span>
                <span className="mono text-xs text-muted-foreground">
                  {r.creatorHandle ? `@${r.creatorHandle}` : short(r.creator)}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <IndexGlyph
                  pubkey={r.pubkey}
                  weights={r.assets.map((a) => a.targetWeightBps)}
                  size={36}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-lg font-bold">{r.name}</span>
                  <span className="mono text-xs text-muted-foreground">{r.symbol}</span>
                </span>
              </span>
              <span className="flex items-end justify-between gap-3">
                <span className="flex flex-col gap-1">
                  <Delta value={ret} className="text-[40px] leading-none font-bold" />
                  {vs !== null ? (
                    <span className="num text-[13px] text-muted-foreground">
                      {vs >= 0 ? "+" : ""}
                      {vs.toFixed(2)} pp vs SPYx
                    </span>
                  ) : null}
                </span>
                <Sparkline data={r.spark} width={96} height={32} />
              </span>
              <TokenWeights assets={r.assets} />
              <span className="mt-auto flex gap-4 border-t border-hairline pt-3 text-xs text-muted-foreground">
                <span>
                  AUM <Usd value={r.navUsd} compact className="text-foreground" />
                </span>
                <span>
                  Holders <span className="num text-foreground">{r.holders}</span>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export default function LeaderboardPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]["v"]>("7d");
  const [tab, setTab] = useState("indexes");
  const [type, setType] = useState("all");
  const k = RANGES.find((r) => r.v === range)?.k ?? "ret7d";
  const idx = useIndexBoard(range, type);
  const creators = useCreatorsBoard(type);
  const typeToggle = (
    <ToggleGroup
      value={[type]}
      onValueChange={(v) => setType((v as string[])[0] ?? "all")}
      variant="outline"
      size="sm"
      aria-label="Creator type"
    >
      <ToggleGroupItem value="all">All</ToggleGroupItem>
      <ToggleGroupItem value="human">Human</ToggleGroupItem>
      <ToggleGroupItem value="ai">AI</ToggleGroupItem>
    </ToggleGroup>
  );
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-8 md:px-8">
      <div className="flex items-center gap-2">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Leaderboard</h1>
        <SimulatedBadge />
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList variant="line">
            <TabsTrigger value="indexes">Indexes</TabsTrigger>
            <TabsTrigger value="creators">Creators</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap gap-2">
            {/* Creator stats are all-time: the range only applies to index returns. */}
            {tab === "indexes" ? (
              <ToggleGroup
                value={[range]}
                onValueChange={(v) => setRange(((v as string[])[0] as typeof range) ?? "7d")}
                variant="outline"
                size="sm"
                aria-label="Range"
              >
                {RANGES.map((r) => (
                  <ToggleGroupItem key={r.v} value={r.v}>
                    {r.v.toUpperCase()}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : null}
            {typeToggle}
          </div>
        </div>
        <TabsContent value="indexes" className="flex flex-col gap-5 pt-5">
          {idx.isLoading ? (
            <RowsSkeleton rows={8} />
          ) : idx.isError ? (
            <ErrorState
              message="Could not load the leaderboard."
              onRetry={() => void idx.refetch()}
            />
          ) : !idx.data?.rows.length ? (
            <EmptyState title="No indexes yet." />
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                SPYx {range.toUpperCase()}: <span className="num">{pct(idx.data.benchmark)}</span>
              </p>
              <Podium rows={idx.data.rows} k={k} benchmark={idx.data.benchmark} />
              <IndexTable rows={idx.data.rows} retKey={k} retLabel={range.toUpperCase()} rank />
            </>
          )}
        </TabsContent>
        <TabsContent value="creators" className="pt-5">
          {creators.isLoading ? (
            <RowsSkeleton rows={6} />
          ) : creators.isError ? (
            <ErrorState
              message="Could not load creators."
              onRetry={() => void creators.refetch()}
            />
          ) : !creators.data?.rows.length ? (
            <EmptyState title="No creators yet." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Creator</TableHead>
                  <TableHead className="text-right">AUM</TableHead>
                  <TableHead className="text-right">Fees earned</TableHead>
                  <TableHead className="text-right">Joiners</TableHead>
                  <TableHead className="text-right">Clones</TableHead>
                  <TableHead className="text-right">Best 7d</TableHead>
                  <TableHead className="text-right">Level</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creators.data.rows.map((c, i) => (
                  <TableRow key={c.wallet} className="h-12">
                    <TableCell className="num text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>
                      <UserLink wallet={c.wallet} handle={c.handle} isAgent={c.isAgent} />
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.indexes} indexes
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Usd value={c.aumUsd} compact />
                    </TableCell>
                    <TableCell className="text-right">
                      <Usd value={c.feesUsd} />
                    </TableCell>
                    <TableCell className="num text-right">{c.joiners}</TableCell>
                    <TableCell className="num text-right">{c.clones}</TableCell>
                    <TableCell className="text-right">
                      <Delta value={c.bestReturn7d} />
                    </TableCell>
                    <TableCell className="num text-right">{c.level}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
