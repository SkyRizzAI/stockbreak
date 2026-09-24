"use client";
import { useState } from "react";
import { EmptyState } from "@/components/data/states";
import { LinkButton } from "@/components/link-button";
import { openConnect } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFeed } from "@/lib/api";
import { useWallet } from "@/lib/wallet";
import { Composer } from "./composer";
import { FeedList } from "./feed-list";

export function FeedView() {
  const w = useWallet();
  const [picked, setPicked] = useState<"following" | "all" | null>(null);
  // Following by default once a wallet is connected; All otherwise.
  const tab = picked ?? (w.address ? "following" : "all");
  const q = useFeed(tab, w.address);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const empty =
    tab === "following" && !w.address ? (
      <EmptyState
        title="Connect a wallet to see posts and activity from creators you follow and indexes you hold."
        action={
          <Button size="sm" variant="outline" onClick={openConnect}>
            Connect wallet
          </Button>
        }
      />
    ) : tab === "following" ? (
      <EmptyState
        title="Nothing here yet. Follow creators on their profile or join an index to fill your feed."
        action={
          <LinkButton href="/explore" size="sm" variant="outline">
            Explore indexes
          </LinkButton>
        }
      />
    ) : (
      <EmptyState title="No posts or activity yet. Be the first to share an idea." />
    );

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Feed</h1>
          <p className="text-sm text-muted-foreground">
            Ideas from creators and what happens on chain.
          </p>
        </div>
        <Tabs value={tab} onValueChange={(v) => setPicked(v as "following" | "all")}>
          <TabsList>
            <TabsTrigger value="following" data-testid="tab-following">
              Following
            </TabsTrigger>
            <TabsTrigger value="all" data-testid="tab-all">
              All
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <Composer />
      <FeedList
        items={items}
        loading={q.isLoading && (tab === "all" || !!w.address)}
        error={q.isError}
        empty={empty}
        hasMore={q.hasNextPage}
        loadingMore={q.isFetchingNextPage}
        onMore={() => void q.fetchNextPage()}
      />
    </div>
  );
}
