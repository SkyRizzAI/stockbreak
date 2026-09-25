"use client";
import Link from "next/link";
import { TickerMono } from "@/components/data/glyph";
import { Delta, Price, toneOf } from "@/components/data/num";
import { PrestocksTag } from "@/components/data/prestocks";
import { ErrorState, RowsSkeleton, Section, SimulatedBadge } from "@/components/data/states";
import { IndexTable } from "@/components/index/index-table";
import { LinkButton } from "@/components/link-button";
import { CreatorCard } from "@/components/pages/creator-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useActivity, useConfig, useCreatorsBoard, useIndexes, usePrices } from "@/lib/api";
import { ago, pct } from "@/lib/format";
import type { IndexSummary } from "@/lib/types";

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

function TickerStrip() {
  const prices = usePrices();
  const cfg = useConfig();
  if (prices.isLoading) return <Skeleton className="h-14 w-full" />;
  if (prices.isError)
    return <ErrorState message="Prices are unavailable." onRetry={() => void prices.refetch()} />;
  // Pre-IPO tokens that already converted at their IPO are no longer tradable: hide them.
  const delisted = new Set((cfg.data?.assets ?? []).filter((a) => !a.listed).map((a) => a.symbol));
  const list = (prices.data ?? []).filter((p) => p.symbol !== "USDC" && !delisted.has(p.symbol));
  if (!list.length) return null;
  // One joined strip (refs Markets): mono ticker, figure, day change; scrolls on small screens.
  return (
    <div className="overflow-x-auto rounded-2xl border bg-surface">
      <ul className="flex min-w-max divide-x divide-hairline" aria-label="Asset prices">
        {list.map((p) => (
          <li key={p.symbol} className="flex min-w-40 flex-1 flex-col gap-1 px-4 py-3.5">
            <span className="flex items-center gap-1.5">
              <TickerMono symbol={p.symbol} size={18} />
              <span className="mono text-xs text-muted-foreground">{p.symbol}</span>
              {p.kind === "PreIpo" ? <PrestocksTag /> : null}
            </span>
            <span className="flex items-baseline gap-2">
              <Price value={p.price} className="text-[17px] font-semibold" />
              <Delta value={p.change24h} className="text-xs" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TopCreators() {
  const q = useCreatorsBoard("all");
  const rows = (q.data?.rows ?? []).slice(0, 3);
  if (!q.isLoading && !rows.length) return null;
  return (
    <Section
      title="Top creators"
      action={
        <Link href="/leaderboard" className="text-sm text-muted-foreground hover:text-foreground">
          See all
        </Link>
      }
    >
      {q.isLoading ? (
        <RowsSkeleton rows={1} className="[&>*]:h-36" />
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {rows.map((c) => (
            <CreatorCard key={c.wallet} c={c} />
          ))}
        </div>
      )}
    </Section>
  );
}

function HumanVsAi({ rows }: { rows: IndexSummary[] }) {
  const human = rows.filter((r) => !r.creatorIsAgent);
  const ai = rows.filter((r) => r.creatorIsAgent);
  const cell = (label: string, list: IndexSummary[]) => {
    const m = median(list.map((r) => r.ret7d).filter((x): x is number => x !== null));
    const best = [...list].sort((a, b) => (b.ret7d ?? -1) - (a.ret7d ?? -1))[0];
    return (
      <div className="flex flex-col gap-2 p-5">
        <span className="text-sm font-semibold">{label} · median 7d</span>
        <span className={`num text-[40px] leading-none font-bold ${toneOf(m, 0.00005)}`}>
          {pct(m)}
        </span>
        <span className="text-[13px] text-muted-foreground">
          {list.length} indexes
          {best ? (
            <>
              {" · best "}
              <Link href={`/i/${best.pubkey}`} className="text-foreground hover:underline">
                {best.symbol}
              </Link>
            </>
          ) : null}
        </span>
      </div>
    );
  };
  return (
    <div className="grid grid-cols-2 divide-x divide-hairline rounded-2xl border bg-surface">
      {cell("Human", human)}
      {cell("AI", ai)}
    </div>
  );
}

export default function Home() {
  const list = useIndexes("sort=aum&limit=100");
  const act = useActivity();
  const rows = list.data?.items ?? [];
  const clones = rows
    .filter((r) => r.parent)
    .sort((a, b) => (b.ret7d ?? -1) - (a.ret7d ?? -1))
    .slice(0, 4);
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-8 px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Markets</h1>
            <SimulatedBadge />
          </div>
          <p className="text-sm text-muted-foreground">
            Tokenized stock indexes. Create one, share it, or join someone else&apos;s.
          </p>
        </div>
        <LinkButton href="/create" size="lg">
          Create index
        </LinkButton>
      </div>

      <TickerStrip />

      <Section
        title="Top indexes"
        action={
          <Link href="/explore" className="text-sm text-muted-foreground hover:text-foreground">
            View all
          </Link>
        }
      >
        {list.isLoading ? (
          <RowsSkeleton rows={6} />
        ) : list.isError ? (
          <ErrorState message="Could not load indexes." onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
            No indexes yet. Create the first one.
          </p>
        ) : (
          <IndexTable rows={rows.slice(0, 6)} />
        )}
      </Section>

      <TopCreators />

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Trending clones">
          {list.isLoading ? (
            <RowsSkeleton rows={3} />
          ) : clones.length ? (
            <IndexTable rows={clones} compact />
          ) : (
            <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
              No clones yet. Open any index and press Clone.
            </p>
          )}
        </Section>
        <div className="flex flex-col gap-8">
          <Section
            title="Human vs AI"
            action={
              <span className="flex items-center gap-3">
                <Link
                  href="/agents"
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Connect AI
                </Link>
                <Link
                  href="/leaderboard"
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Leaderboard
                </Link>
              </span>
            }
          >
            {list.isLoading ? <Skeleton className="h-28" /> : <HumanVsAi rows={rows} />}
          </Section>
          <Section title="Latest activity">
            {act.isLoading ? (
              <RowsSkeleton rows={4} />
            ) : (act.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="divide-y rounded-2xl border text-sm">
                {(act.data ?? []).slice(0, 6).map((a) => (
                  <li
                    key={`${a.signature}-${a.type}`}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="min-w-0 truncate">
                      {a.index ? (
                        <Link
                          href={`/i/${a.index}`}
                          className="num mr-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                          {a.indexSymbol}
                        </Link>
                      ) : null}
                      {a.summary}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{ago(a.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
