"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/data/states";
import { LinkButton } from "@/components/link-button";
import { openConnect } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFeed, useIndex } from "@/lib/api";
import { useWallet } from "@/lib/wallet";
import { Composer } from "./composer";
import { FeedList } from "./feed-list";

export function FeedView() {
  const w = useWallet();
  const router = useRouter();
  // `/feed?share=<index>` opens the composer with that index as a card (D035).
  const shareKey = useSearchParams().get("share");
  const shareIndex = useIndex(shareKey ?? "");
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setPicked("all")}>
              See all posts
            </Button>
            <LinkButton href="/explore" size="sm" variant="outline">
              Explore indexes
            </LinkButton>
          </div>
        }
      />
    ) : (
      <EmptyState title="No posts or activity yet. Be the first to share an idea." />
    );

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Feed</h1>
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
      <Composer
        share={shareKey && shareIndex.data ? shareIndex.data : null}
        onShared={() => {
          setPicked("all");
          if (shareKey) router.replace("/feed");
        }}
      />
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
