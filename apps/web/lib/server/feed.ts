import "server-only";
/** Feed assembly (PLAN §7.7, D033): posts + on-chain activity, newest first. */
import {
  allIndexes,
  type CommentRow,
  feedEvents,
  followeesOf,
  getUsers,
  indexesOfWallet,
  likedBy,
  listPosts,
  type PostRow,
} from "@repo/db";
import type {
  ActivityFeedItem,
  AuthorInfo,
  CommentItem,
  FeedPage,
  IndexRef,
  PostItem,
} from "../types";
import { db } from "./ctx";
import { describe } from "./data";

/** Notable activity for everyone; Following also shows joins, redeems and claims. */
const ALL_TYPES = ["IndexCreated", "RebalanceExecuted", "IpoMigrated", "IndexUpdated"];
const FOLLOWING_TYPES = [
  ...ALL_TYPES,
  "Joined",
  "Redeemed",
  "FeesClaimed",
  "ManagersSet",
  "TargetsSynced",
];

async function refs() {
  const map = new Map<string, IndexRef>();
  for (const r of await allIndexes(db()))
    map.set(r.pubkey, { pubkey: r.pubkey, symbol: r.symbol, name: r.name });
  return map;
}

async function authors(wallets: string[]): Promise<Map<string, AuthorInfo>> {
  const u = await getUsers(db(), [...new Set(wallets)]);
  const out = new Map<string, AuthorInfo>();
  for (const w of new Set(wallets)) {
    const x = u.get(w);
    out.set(w, { wallet: w, handle: x?.handle ?? null, isAgent: x?.isAgent ?? false });
  }
  return out;
}

export async function toPostItems(rows: PostRow[], viewer: string | null): Promise<PostItem[]> {
  const [who, idx, liked] = await Promise.all([
    authors(rows.map((r) => r.author)),
    refs(),
    viewer
      ? likedBy(
          db(),
          viewer,
          rows.map((r) => r.id),
        )
      : Promise.resolve(new Set<number>()),
  ]);
  return rows.map((r) => ({
    kind: "post",
    id: r.id,
    ts: r.createdAt.toISOString(),
    author: who.get(r.author) as AuthorInfo,
    index: r.index ? (idx.get(r.index) ?? null) : null,
    body: r.body,
    likes: r.likeCount,
    comments: r.commentCount,
    liked: liked.has(r.id),
  }));
}

export async function toCommentItems(rows: CommentRow[]): Promise<CommentItem[]> {
  const who = await authors(rows.map((r) => r.author));
  return rows.map((r) => ({
    id: r.id,
    ts: r.createdAt.toISOString(),
    author: who.get(r.author) as AuthorInfo,
    body: r.body,
  }));
}

export async function feed(opts: {
  tab: "all" | "following";
  viewer: string | null;
  before: Date;
  limit: number;
}): Promise<FeedPage> {
  const d = db();
  let postRows: PostRow[];
  let eventRows: Awaited<ReturnType<typeof feedEvents>>;
  if (opts.tab === "following") {
    if (!opts.viewer) return { items: [], next: null };
    const [followees, held] = await Promise.all([
      followeesOf(d, opts.viewer),
      indexesOfWallet(d, opts.viewer),
    ]);
    [postRows, eventRows] = await Promise.all([
      listPosts(
        d,
        { authors: [...followees, opts.viewer], indexes: held },
        opts.before,
        opts.limit,
      ),
      followees.length || held.length
        ? feedEvents(
            d,
            { wallets: followees, indexes: held, types: FOLLOWING_TYPES },
            opts.before,
            opts.limit,
          )
        : Promise.resolve([]),
    ]);
  } else {
    [postRows, eventRows] = await Promise.all([
      listPosts(d, {}, opts.before, opts.limit),
      feedEvents(d, { types: ALL_TYPES }, opts.before, opts.limit),
    ]);
  }
  const [posts, who, idx] = await Promise.all([
    toPostItems(postRows, opts.viewer),
    authors(eventRows.map((e) => e.wallet).filter((w): w is string => !!w)),
    refs(),
  ]);
  const acts: ActivityFeedItem[] = eventRows.map((e) => ({
    kind: "activity",
    id: `${e.signature}:${e.ixIndex}`,
    ts: e.ts.toISOString(),
    author: e.wallet ? (who.get(e.wallet) ?? null) : null,
    index: e.index ? (idx.get(e.index) ?? null) : null,
    type: e.type,
    summary: describe(e.type, e.data as Record<string, unknown>),
  }));
  const items = [...posts, ...acts].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, opts.limit);
  const exhausted =
    postRows.length < opts.limit && eventRows.length < opts.limit && items.length < opts.limit;
  return { items, next: exhausted ? null : (items.at(-1)?.ts ?? null) };
}
