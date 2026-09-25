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
import {
  type ActivityFeedItem,
  type AuthorInfo,
  CARD_VARIANTS,
  type CardVariant,
  type CommentItem,
  type FeedPage,
  type IndexRef,
  type IndexSummary,
  type PostItem,
} from "../types";
import { db } from "./ctx";
import { describe, indexSummaries } from "./data";

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
  for (const r of await allIndexes(db())) {
    const assets = ((r.assets as { symbol: string; targetWeightBps: number }[]) ?? [])
      .filter((a) => a.targetWeightBps > 0)
      .sort((a, b) => b.targetWeightBps - a.targetWeightBps)
      .map((a) => a.symbol);
    map.set(r.pubkey, { pubkey: r.pubkey, symbol: r.symbol, name: r.name, assets });
  }
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

/** Summaries (with card data) for the indexes attached to these posts. */
async function cardData(rows: PostRow[]): Promise<Map<string, IndexSummary>> {
  const want = new Set(rows.map((r) => r.index).filter((i): i is string => !!i));
  if (!want.size) return new Map();
  return new Map((await indexSummaries((r) => want.has(r.pubkey))).map((s) => [s.pubkey, s]));
}

const VARIANTS = new Set<string>(CARD_VARIANTS);

export async function toPostItems(rows: PostRow[], viewer: string | null): Promise<PostItem[]> {
  const [who, idx, liked] = await Promise.all([
    authors(rows.map((r) => r.author)),
    cardData(rows),
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
    cardVariant:
      r.cardVariant && VARIANTS.has(r.cardVariant) ? (r.cardVariant as CardVariant) : null,
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

/** Feed cursor: one keyset position per source (posts by id, events by ts+signature+ix). */
export interface FeedCursor {
  /** null = from the newest row. */
  post: number | null;
  event: { ts: string; signature: string; ixIndex: number } | null;
  postsDone: boolean;
  eventsDone: boolean;
}

export function encodeCursor(c: FeedCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(s: string | null): FeedCursor | null | "invalid" {
  if (!s) return null;
  try {
    const c = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as FeedCursor;
    const okPost = c.post === null || Number.isInteger(c.post);
    const okEvent =
      c.event === null ||
      (typeof c.event?.signature === "string" &&
        Number.isInteger(c.event.ixIndex) &&
        !Number.isNaN(new Date(c.event.ts).getTime()));
    return okPost &&
      okEvent &&
      typeof c.postsDone === "boolean" &&
      typeof c.eventsDone === "boolean"
      ? c
      : "invalid";
  } catch {
    return "invalid";
  }
}

export async function feed(opts: {
  tab: "all" | "following";
  viewer: string | null;
  cursor: FeedCursor | null;
  limit: number;
}): Promise<FeedPage> {
  const beforePost = opts.cursor ? opts.cursor.post : null;
  const beforeEvent = opts.cursor?.event
    ? { ...opts.cursor.event, ts: new Date(opts.cursor.event.ts) }
    : null;
  // On-chain activity (keeper rebalances, IPO migrations) can outnumber posts many times
  // over; cap it per page so people's posts are never pushed off the first screens.
  const eventLimit = Math.max(1, Math.ceil(opts.limit / 3));
  const postsDone = opts.cursor?.postsDone ?? false;
  const eventsDone = opts.cursor?.eventsDone ?? false;
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
      postsDone
        ? Promise.resolve([])
        : listPosts(
            d,
            { authors: [...followees, opts.viewer], indexes: held },
            beforePost,
            opts.limit,
          ),
      !eventsDone && (followees.length || held.length)
        ? feedEvents(
            d,
            { wallets: followees, indexes: held, types: FOLLOWING_TYPES },
            beforeEvent,
            eventLimit,
          )
        : Promise.resolve([]),
    ]);
  } else {
    [postRows, eventRows] = await Promise.all([
      postsDone ? Promise.resolve([]) : listPosts(d, {}, beforePost, opts.limit),
      eventsDone
        ? Promise.resolve([])
        : feedEvents(d, { types: ALL_TYPES }, beforeEvent, eventLimit),
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
  // Each source continues after the last of its rows shown on this page.
  const shownPosts = items.filter((i) => i.kind === "post").length;
  const shownEvents = items.length - shownPosts;
  const lastPost = postRows[shownPosts - 1];
  const lastEvent = eventRows[shownEvents - 1];
  const postsLeft = shownPosts < postRows.length || postRows.length === opts.limit;
  const eventsLeft = shownEvents < eventRows.length || eventRows.length === eventLimit;
  const next: FeedCursor = {
    post: lastPost ? lastPost.id : beforePost,
    event: lastEvent
      ? {
          ts: lastEvent.ts.toISOString(),
          signature: lastEvent.signature,
          ixIndex: lastEvent.ixIndex,
        }
      : (opts.cursor?.event ?? null),
    postsDone: !postsLeft,
    eventsDone: !eventsLeft,
  };
  return {
    items,
    next: postsLeft || eventsLeft ? encodeCursor(next) : null,
  };
}
