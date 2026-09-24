"use client";
import { Copy, Download, Link2, Share2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { UserLink } from "@/components/data/addr";
import { AllocationBar, AllocationLegend } from "@/components/data/allocation";
import { IndexGlyph, TickerMono } from "@/components/data/glyph";
import { Delta, Price, Usd } from "@/components/data/num";
import {
  ErrorState,
  KV,
  NotFoundState,
  RowsSkeleton,
  Section,
  SimulatedBadge,
  Tag,
} from "@/components/data/states";
import { LinkButton } from "@/components/link-button";
import { openConnect } from "@/components/shell/wallet-button";
import { PostThread } from "@/components/social/post-thread";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, useActivity, useHolders, useIndex } from "@/lib/api";
import { ago, bps, duration, num, pct, short } from "@/lib/format";
import { txUrl } from "@/lib/solana";
import type { IndexDetail } from "@/lib/types";
import { useWallet } from "@/lib/wallet";
import { IndexTags } from "./index-table";
import { PerfChart } from "./perf-chart";
import { TradePanel } from "./trade-panel";

function strategyLabel(d: IndexDetail): string {
  const s = d.strategy;
  if (s.mode === "Threshold") return `Rebalance when drift > ${bps(s.driftThresholdBps)}`;
  if (s.mode === "Periodic") return `Rebalance every ${duration(s.periodSecs)}`;
  return "Manual (creator or manager)";
}

function ShareMenu({ d }: { d: IndexDetail }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = `${origin}/i/${d.pubkey}`;
  const blink = `solana-action:${origin}/api/actions/join/${d.pubkey}`;
  const copy = (t: string, m: string) => {
    void navigator.clipboard.writeText(t);
    toast.success(m);
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="lg" />}>
        <Share2 />
        Share
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => copy(link, "Link copied")}>
          <Link2 />
          Copy link
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => copy(blink, "Blink URL copied")}>
          <Copy />
          Copy Blink (Solana Action)
        </DropdownMenuItem>
        <DropdownMenuItem
          render={<a href={`/i/${d.pubkey}/opengraph-image`} download={`${d.symbol}.png`} />}
        >
          <Download />
          Download card
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Allocation({ d }: { d: IndexDetail }) {
  return (
    <Section
      title="Allocation"
      action={
        <span className="num text-xs text-muted-foreground">
          Drift {bps(d.driftSumBps)} · max {bps(d.driftMaxBps)}
        </span>
      }
    >
      <AllocationBar
        slices={d.live.map((a) => ({ label: a.symbol, weightBps: a.weightBps }))}
        height={10}
      />
      <AllocationLegend slices={d.live.map((a) => ({ label: a.symbol, weightBps: a.weightBps }))} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Price</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Value</TableHead>
            <TableHead className="text-right">Weight</TableHead>
            <TableHead className="text-right">Target</TableHead>
            <TableHead className="text-right">Drift</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.live.map((a) => {
            const drift = a.weightBps - a.targetWeightBps;
            const hot =
              Math.abs(drift) >
              (d.strategy.mode === "Threshold" ? d.strategy.driftThresholdBps : 500);
            return (
              <TableRow key={a.mint}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <TickerMono symbol={a.symbol} />
                    <span className="flex flex-col leading-tight">
                      <span className="num text-sm">{a.symbol}</span>
                      <span className="text-xs text-muted-foreground">
                        {a.name}
                        {a.kind === "PreIpo" ? " · pre-IPO" : ""}
                        {a.multiplier !== 1 ? ` · ×${a.multiplier}` : ""}
                      </span>
                    </span>
                  </span>
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  <Price value={a.priceUsd} />
                </TableCell>
                <TableCell className="hidden text-right sm:table-cell">
                  <Usd value={a.valueUsd} />
                </TableCell>
                <TableCell className="num text-right">{bps(a.weightBps)}</TableCell>
                <TableCell className="num text-right text-muted-foreground">
                  {bps(a.targetWeightBps)}
                </TableCell>
                <TableCell
                  className={`num text-right ${hot ? "text-warn" : "text-muted-foreground"}`}
                >
                  {drift > 0 ? "+" : ""}
                  {bps(drift)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Section>
  );
}

function Activity({ pubkey }: { pubkey: string }) {
  const q = useActivity(pubkey);
  const rows = q.data ?? [];
  return (
    <Section title="Activity">
      {q.isLoading ? (
        <RowsSkeleton rows={4} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {rows.slice(0, 20).map((a) => (
            <li
              key={`${a.signature}-${a.type}-${a.summary}`}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{a.summary}</span>
                <span className="text-xs text-muted-foreground">
                  {a.wallet ? <UserLink wallet={a.wallet} handle={a.handle} /> : "—"}
                </span>
              </span>
              <a
                href={txUrl(a.signature)}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              >
                {ago(a.ts)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Holders({ pubkey }: { pubkey: string }) {
  const q = useHolders(pubkey);
  const rows = q.data ?? [];
  return (
    <Section title={`Holders${rows.length ? ` (${rows.length})` : ""}`}>
      {q.isLoading ? (
        <RowsSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No holders yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {rows.slice(0, 10).map((h) => (
            <li key={h.wallet} className="flex items-center justify-between px-3 py-2">
              <UserLink wallet={h.wallet} handle={h.handle} />
              <span className="num text-muted-foreground">
                {num(h.shares)} · {pct(h.pct, 1, false)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Timeline({ d }: { d: IndexDetail }) {
  const items = [
    {
      ts: d.createdAt,
      label: d.parent
        ? `Created as a ${d.followsParent ? "follower" : "clone"} of ${d.parentSymbol ?? short(d.parent)}`
        : "Created",
    },
    ...d.ipoEvents.map((e) => ({
      ts: e.ts,
      label: `IPO: ${e.oldSymbol} converted to ${e.newSymbol}`,
    })),
  ].sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <Section title="Timeline">
      <ol className="relative ml-2 border-l pl-4 text-sm">
        {items.map((i) => (
          <li key={`${i.ts}-${i.label}`} className="mb-3 last:mb-0">
            <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border bg-background" />
            <div>{i.label}</div>
            <div className="text-xs text-muted-foreground">
              {new Date(i.ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function IndexView({ pubkey }: { pubkey: string }) {
  const q = useIndex(pubkey);
  const w = useWallet();
  const [range, setRange] = useState("1M");
  const [bench, setBench] = useState(true);
  if (q.isLoading)
    return (
      <div className="mx-auto grid max-w-[1200px] gap-6 px-4 py-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-2/3" />
          <Skeleton className="h-72" />
          <RowsSkeleton rows={4} />
        </div>
        <Skeleton className="hidden h-96 lg:block" />
      </div>
    );
  if (
    (q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400)) ||
    (!q.isError && !q.data)
  )
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <NotFoundState
          title="Index not found"
          detail="There is no index at this address on this network. Check the link, or browse the indexes that exist."
        />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <ErrorState
          message={q.error?.message ?? "Index not found."}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  const d = q.data;
  const isCreator = w.address === d.creator;
  const panel = <TradePanel d={d} onConnect={openConnect} />;
  const royalty = d.parent
    ? [
        [
          `Clone royalty to ${d.parentSymbol ?? "parent"}`,
          `${bps(d.fees.cloneRoyaltyBps, 0)} of creator fee`,
        ] as [string, string],
      ]
    : [];
  return (
    <div className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 py-6 lg:grid-cols-[1fr_360px]">
      <div className="flex min-w-0 flex-col gap-8">
        <header className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <IndexGlyph
                pubkey={d.pubkey}
                weights={d.assets.map((a) => a.targetWeightBps)}
                size={44}
              />
              <div className="flex min-w-0 flex-col gap-1">
                <h1 className="flex flex-wrap items-baseline gap-2 text-xl font-semibold tracking-tight">
                  <span className="truncate">{d.name}</span>
                  <span className="num text-sm text-muted-foreground">{d.symbol}</span>
                </h1>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span>
                    by{" "}
                    <UserLink
                      wallet={d.creator}
                      handle={d.creatorHandle}
                      isAgent={d.creatorIsAgent}
                      className="text-foreground"
                    />
                  </span>
                  <IndexTags i={d} />
                  <SimulatedBadge />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {isCreator ? (
                <LinkButton href={`/i/${d.pubkey}/manage`} variant="outline" size="lg">
                  Manage
                </LinkButton>
              ) : null}
              <LinkButton href={`/create?clone=${d.pubkey}`} variant="outline" size="lg">
                Clone
              </LinkButton>
              <ShareMenu d={d} />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">Share price</span>
              <span className="num text-4xl font-medium tracking-tight" data-testid="share-price">
                ${d.sharePriceLive.toFixed(4)}
              </span>
            </div>
            <div className="flex gap-5 pb-1 text-sm">
              <span className="flex flex-col">
                <span className="text-xs text-muted-foreground">24h</span>
                <Delta value={d.ret24h} />
              </span>
              <span className="flex flex-col">
                <span className="text-xs text-muted-foreground">7d</span>
                <Delta value={d.ret7d} />
              </span>
              <span className="flex flex-col">
                <span className="text-xs text-muted-foreground">NAV</span>
                <Usd value={d.navLiveUsd} compact />
              </span>
              <span className="flex flex-col">
                <span className="text-xs text-muted-foreground">Holders</span>
                <span className="num">{d.holders}</span>
              </span>
            </div>
          </div>
          {d.description ? (
            <p className="max-w-prose text-sm text-muted-foreground">{d.description}</p>
          ) : null}
        </header>

        <PerfChart
          pubkey={d.pubkey}
          range={range}
          onRange={setRange}
          showBench={bench}
          onBench={setBench}
          live={d.sharePriceLive}
        />

        <Allocation d={d} />

        {d.thesis ? (
          <Section title="Thesis">
            <p className="max-w-prose text-sm leading-relaxed">{d.thesis}</p>
          </Section>
        ) : null}

        <div className="grid gap-8 md:grid-cols-2">
          <Section title="Strategy & guards">
            <KV
              rows={[
                ["Rebalancing", strategyLabel(d)],
                [
                  "Max slippage",
                  <span key="s" className="num">
                    {bps(d.strategy.maxSlippageBps)}
                  </span>,
                ],
                [
                  "Cooldown",
                  <span key="c" className="num">
                    {duration(d.strategy.cooldownSecs)}
                  </span>,
                ],
                ["Keeper", d.strategy.allowKeeper ? "Allowed" : "Off"],
                [
                  "Update timelock",
                  <span key="t" className="num">
                    {d.timelockSecs ? duration(d.timelockSecs) : "None"}
                  </span>,
                ],
                ["Last rebalance", ago(d.lastRebalanceTs * 1000)],
              ]}
            />
          </Section>
          <Section title="Fees">
            <KV
              rows={[
                [
                  "Management (creator)",
                  <span key="m" className="num">
                    {bps(d.fees.mgmtFeeBps)} / yr
                  </span>,
                ],
                [
                  "Platform",
                  <span key="p" className="num">
                    {bps(d.fees.platformFeeBps)} / yr
                  </span>,
                ],
                [
                  "Entry",
                  <span key="e" className="num">
                    {bps(d.fees.entryFeeBps)}
                  </span>,
                ],
                [
                  "Exit",
                  <span key="x" className="num">
                    {bps(d.fees.exitFeeBps)}
                  </span>,
                ],
                ...royalty,
              ]}
            />
          </Section>
        </div>

        <div className="grid gap-8 md:grid-cols-2">
          <Section title="Managers">
            {d.managers.length ? (
              <ul className="divide-y rounded-lg border text-sm">
                {d.managers.map((m) => (
                  <li key={m.wallet} className="flex items-center justify-between px-3 py-2">
                    <UserLink wallet={m.wallet} handle={m.handle} isAgent={m.isAgent} />
                    <span className="text-xs text-muted-foreground">Can rebalance only</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No managers. Only the creator and the keeper can rebalance.
              </p>
            )}
          </Section>
          <Holders pubkey={d.pubkey} />
        </div>

        {d.children.length ? (
          <Section title="Clones & followers">
            <ul className="divide-y rounded-lg border text-sm">
              {d.children.map((c) => (
                <li key={c.pubkey}>
                  <Link
                    href={`/i/${c.pubkey}`}
                    className="flex items-center justify-between px-3 py-2 hover:bg-muted/50"
                  >
                    <span>
                      {c.name} <span className="num text-xs text-muted-foreground">{c.symbol}</span>
                    </span>
                    <Tag>{c.followsParent ? "Follows" : "Clone"}</Tag>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <PostThread
          title="Discussion"
          index={{ pubkey: d.pubkey, symbol: d.symbol, name: d.name }}
        />

        <div className="grid gap-8 md:grid-cols-2">
          <Activity pubkey={d.pubkey} />
          <Timeline d={d} />
        </div>
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-20 rounded-xl border p-4">{panel}</div>
      </aside>

      <div className="fixed inset-x-0 bottom-14 z-30 border-t bg-background/95 p-3 backdrop-blur-sm lg:hidden">
        <Drawer>
          <DrawerTrigger
            render={<Button size="lg" className="h-11 w-full" data-testid="open-trade" />}
          >
            Join or redeem
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>
                {d.name} <span className="num text-sm text-muted-foreground">{d.symbol}</span>
              </DrawerTitle>
            </DrawerHeader>
            <div className="max-h-[75vh] overflow-y-auto px-4 pb-6">{panel}</div>
          </DrawerContent>
        </Drawer>
      </div>
    </div>
  );
}
