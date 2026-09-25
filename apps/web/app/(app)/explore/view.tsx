"use client";
import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState, ErrorState, RowsSkeleton, SimulatedBadge } from "@/components/data/states";
import { IndexTable } from "@/components/index/index-table";
import { LinkButton } from "@/components/link-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIndexes } from "@/lib/api";
import { pct } from "@/lib/format";

const SORTS = [
  { v: "aum", l: "AUM" },
  { v: "return", l: "7d return" },
  { v: "holders", l: "Holders" },
  { v: "newest", l: "Newest" },
];
const STRATS = [
  { v: "all", l: "Any strategy" },
  { v: "Threshold", l: "Rebalance on drift" },
  { v: "Periodic", l: "Periodic" },
  { v: "Manual", l: "Manual" },
];

export function ExploreView() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const type = sp.get("type") ?? "all";
  const sort = sp.get("sort") ?? "aum";
  const strategy = sp.get("strategy") ?? "all";
  const preipo = sp.get("preipo") === "1";
  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp.toString());
    if (v === null || v === "" || v === "all") n.delete(k);
    else n.set(k, v);
    router.replace(`${path}?${n.toString()}`, { scroll: false });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: debounce on the input value only
  useEffect(() => {
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) set("q", q);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  const qs = new URLSearchParams({
    sort,
    type,
    limit: "100",
    // The debounced value (URL), not every keystroke.
    ...(sp.get("q") ? { q: sp.get("q") as string } : {}),
    ...(preipo ? { preipo: "1" } : {}),
    ...(strategy !== "all" ? { strategy } : {}),
  });
  const list = useIndexes(qs.toString());
  const items = list.data?.items ?? [];
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5 px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Explore</h1>
            <SimulatedBadge />
          </div>
          <p className="text-sm text-muted-foreground">
            {list.data ? `${list.data.total} indexes` : "Indexes"}
            {list.data?.benchmark.ret7d !== undefined && list.data?.benchmark.ret7d !== null
              ? ` · SPYx 7d ${pct(list.data.benchmark.ret7d)}`
              : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative md:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search indexes"
            placeholder="Search name, symbol, asset"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-9 pl-8"
          />
        </div>
        <ToggleGroup
          value={[type]}
          onValueChange={(v) => set("type", (v as string[])[0] ?? "all")}
          variant="outline"
          size="sm"
          aria-label="Creator type"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="human">Human</ToggleGroupItem>
          <ToggleGroupItem value="ai">AI</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          value={preipo ? ["1"] : []}
          onValueChange={(v) => set("preipo", (v as string[]).includes("1") ? "1" : null)}
          variant="outline"
          size="sm"
          aria-label="Pre-IPO"
        >
          <ToggleGroupItem value="1">Pre-IPO</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex gap-2 md:ml-auto">
          <Select value={strategy} onValueChange={(v) => set("strategy", String(v))}>
            <SelectTrigger className="h-9 w-44" aria-label="Strategy">
              <SelectValue>{STRATS.find((s) => s.v === strategy)?.l}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STRATS.map((s) => (
                <SelectItem key={s.v} value={s.v}>
                  {s.l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => set("sort", String(v))}>
            <SelectTrigger className="h-9 w-36" aria-label="Sort">
              <SelectValue>{SORTS.find((s) => s.v === sort)?.l}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.v} value={s.v}>
                  {s.l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {list.isLoading ? (
        <RowsSkeleton rows={8} />
      ) : list.isError ? (
        <ErrorState message="Could not load indexes." onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No indexes match these filters."
          action={
            <LinkButton href="/create" variant="outline" size="sm">
              Create one
            </LinkButton>
          }
        />
      ) : (
        <>
          <IndexTable rows={items} />
          {list.data && list.data.total > items.length ? (
            <p className="text-center text-sm text-muted-foreground">
              Showing the first {items.length} of {list.data.total}. Search or filter to narrow the
              list.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
