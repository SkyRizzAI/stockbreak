"use client";
/** Mixed feed: post cards and compact on-chain activity rows (D033). */
import Link from "next/link";
import type { ReactNode } from "react";
import { UserLink } from "@/components/data/addr";
import { Avatar } from "@/components/data/avatar";
import { RowsSkeleton } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { ago } from "@/lib/format";
import type { ActivityFeedItem, FeedItem } from "@/lib/types";
import { PostCard } from "./post-card";

/** "Created" → "created" mid-sentence; keeps acronyms such as "IPO: …". */
const sentence = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0]?.toLowerCase() + s.slice(1) : s);

function ActivityRow({ a }: { a: ActivityFeedItem }) {
  return (
    <li className="flex items-start gap-3 px-1 py-2 text-sm" data-testid="activity-row">
      {a.author ? (
        <Avatar seed={a.author.wallet} size={24} />
      ) : (
        <span className="size-6 shrink-0 rounded-md border bg-muted" aria-hidden />
      )}
      <p className="min-w-0 flex-1 text-muted-foreground">
        {a.author ? (
          <UserLink
            wallet={a.author.wallet}
            handle={a.author.handle}
            isAgent={a.author.isAgent}
            className="text-foreground"
          />
        ) : (
          <span className="text-foreground">Keeper</span>
        )}{" "}
        <span>{sentence(a.summary)}</span>
        {a.index ? (
          <>
            {" · "}
            <Link href={`/i/${a.index.pubkey}`} className="num text-foreground hover:underline">
              {a.index.symbol}
            </Link>
          </>
        ) : null}
      </p>
      <time dateTime={a.ts} className="shrink-0 text-xs text-muted-foreground">
        {ago(a.ts)}
      </time>
    </li>
  );
}

export function FeedList({
  items,
  loading,
  error,
  empty,
  hasMore,
  loadingMore,
  onMore,
}: {
  items: FeedItem[];
  loading: boolean;
  error: boolean;
  empty: ReactNode;
  hasMore?: boolean;
  loadingMore?: boolean;
  onMore?: () => void;
}) {
  if (loading) return <RowsSkeleton rows={5} className="[&>*]:h-24" />;
  if (error)
    return (
      <p role="alert" className="rounded-lg border px-4 py-6 text-sm text-down">
        The feed is unavailable right now.
      </p>
    );
  if (!items.length) return <>{empty}</>;
  // Group consecutive activity rows into one quiet list between post cards.
  const blocks: (FeedItem | ActivityFeedItem[])[] = [];
  for (const it of items) {
    const last = blocks.at(-1);
    if (it.kind === "activity" && Array.isArray(last)) last.push(it);
    else blocks.push(it.kind === "activity" ? [it] : it);
  }
  return (
    <div className="flex flex-col gap-3" data-testid="feed-list">
      {blocks.map((b) =>
        Array.isArray(b) ? (
          <ul key={b[0]?.id} className="divide-y">
            {b.map((a) => (
              <ActivityRow key={a.id} a={a} />
            ))}
          </ul>
        ) : b.kind === "post" ? (
          <PostCard key={`p${b.id}`} post={b} />
        ) : null,
      )}
      {hasMore ? (
        <Button variant="outline" className="self-center" disabled={loadingMore} onClick={onMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}
