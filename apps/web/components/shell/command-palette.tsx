"use client";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TickerMono } from "@/components/data/glyph";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { api } from "@/lib/api";
import { short } from "@/lib/format";

interface SearchResult {
  indexes: { pubkey: string; name: string; symbol: string }[];
  assets: { symbol: string; name: string; kind: string }[];
  creators: { wallet: string; handle: string | null; isAgent: boolean }[];
}

/** Search (⌘K). `bar`: a field in the top bar; `sidebar`: full width in the dashboard sidebar. */
export function CommandPalette({ variant = "bar" }: { variant?: "bar" | "sidebar" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const res = useQuery({
    queryKey: ["search", q],
    queryFn: () => api<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
  });
  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === "sidebar"
            ? "flex h-10 w-full items-center justify-between rounded-[10px] border bg-raised px-3 text-sm text-muted-foreground shadow-[inset_0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:text-foreground"
            : "hidden h-[38px] w-60 items-center justify-between rounded-[9px] border border-hairline bg-raised px-3 text-sm text-muted-foreground shadow-[inset_0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:text-foreground lg:flex"
        }
      >
        <span className="inline-flex items-center gap-2">
          <Search className="size-4" />
          Search
        </span>
        <Kbd>⌘K</Kbd>
      </button>
      {variant === "bar" ? (
        <Button
          variant="ghost"
          size="icon-lg"
          className="lg:hidden"
          aria-label="Search"
          onClick={() => setOpen(true)}
        >
          <Search />
        </Button>
      ) : null}
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search"
        description="Search indexes, assets and creators"
      >
        {/* The dialog no longer wraps its children in cmdk's root; the server does the filtering. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search indexes, assets, creators…"
            value={q}
            onValueChange={setQ}
          />
          <CommandList>
            <CommandEmpty>{q ? "No results." : "Type to search."}</CommandEmpty>
            {res.data?.indexes.length ? (
              <CommandGroup heading="Indexes">
                {res.data.indexes.map((i) => (
                  <CommandItem
                    key={i.pubkey}
                    value={`idx ${i.name} ${i.symbol}`}
                    onSelect={() => go(`/i/${i.pubkey}`)}
                  >
                    <span className="mono text-xs text-muted-foreground">{i.symbol}</span>
                    {i.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {res.data?.assets.length ? (
              <CommandGroup heading="Assets">
                {res.data.assets.map((a) => (
                  <CommandItem
                    key={a.symbol}
                    value={`asset ${a.symbol} ${a.name}`}
                    onSelect={() => go(`/explore?q=${encodeURIComponent(a.symbol)}`)}
                  >
                    <TickerMono symbol={a.symbol} />
                    {a.name}
                    <span className="ml-auto text-xs text-muted-foreground">Simulated</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            {res.data?.creators.length ? (
              <CommandGroup heading="Creators">
                {res.data.creators.map((c) => (
                  <CommandItem
                    key={c.wallet}
                    value={`user ${c.handle ?? ""} ${c.wallet}`}
                    onSelect={() => go(`/u/${c.wallet}`)}
                  >
                    {c.handle ? `@${c.handle}` : short(c.wallet)}
                    {c.isAgent ? (
                      <span className="ml-auto text-xs text-muted-foreground">AI</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
