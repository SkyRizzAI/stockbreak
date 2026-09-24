"use client";
/** Posts scoped to an index (Discussion) or an author (profile). */
import { EmptyState, RowsSkeleton, Section } from "@/components/data/states";
import { usePosts } from "@/lib/api";
import type { IndexRef } from "@/lib/types";
import { useWallet } from "@/lib/wallet";
import { Composer } from "./composer";
import { PostCard } from "./post-card";

export function PostThread({
  title,
  index,
  author,
}: {
  title: string;
  index?: IndexRef;
  author?: string;
}) {
  const w = useWallet();
  const q = usePosts({ index: index?.pubkey, author }, w.address);
  const posts = q.data?.items ?? [];
  const canPost = !!index || (author && author === w.address);
  return (
    <Section title={title}>
      <div className="flex flex-col gap-3">
        {canPost ? <Composer index={index ?? null} /> : null}
        {q.isLoading ? (
          <RowsSkeleton rows={2} className="[&>*]:h-24" />
        ) : q.isError ? (
          <p role="alert" className="text-sm text-down">
            Posts are unavailable right now.
          </p>
        ) : posts.length === 0 ? (
          <EmptyState title={index ? `No posts about ${index.symbol} yet.` : "No posts yet."} />
        ) : (
          posts.map((p) => <PostCard key={p.id} post={p} />)
        )}
      </div>
    </Section>
  );
}
