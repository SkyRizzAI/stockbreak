/**
 * Social feed queries (D033): sessions, posts, likes, comments and the
 * counters used by anti-spam rules. DB access only via packages/db.
 * SQLite dialect (D051): counters are recomputed from their source rows inside one
 * atomic batch (D1 has no interactive transactions).
 */
import { and, count, desc, eq, gte, inArray, isNull, lt, max, or, sql } from "drizzle-orm";
import type { Db } from "./client";
import type { EventRow } from "./queries";
import {
  authSessions,
  events,
  indexes,
  positions,
  postComments,
  postLikes,
  posts,
  socialFollows,
} from "./schema";
import { inList } from "./sqlite";

export type PostRow = typeof posts.$inferSelect;
export type CommentRow = typeof postComments.$inferSelect;

// ---------------- sessions ----------------

export async function createSession(
  db: Db,
  row: { tokenHash: string; wallet: string; expiresAt: Date },
): Promise<void> {
  await db.insert(authSessions).values(row);
}

/** Wallet of a live session, or null. */
export async function sessionWallet(db: Db, tokenHash: string): Promise<string | null> {
  const [r] = await db
    .select({ wallet: authSessions.wallet, expiresAt: authSessions.expiresAt })
    .from(authSessions)
    .where(eq(authSessions.tokenHash, tokenHash))
    .limit(1);
  return r && r.expiresAt > new Date() ? r.wallet : null;
}

export async function deleteSession(db: Db, tokenHash: string): Promise<void> {
  await db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash));
}

// ---------------- anti-spam counters ----------------

/** "Skin in the game": the wallet joined or created at least one index on this cluster. */
export async function hasOnchainActivity(db: Db, wallet: string): Promise<boolean> {
  const r = await db
    .select({ one: sql<number>`1` })
    .from(events)
    .where(and(eq(events.wallet, wallet), inArray(events.type, ["Joined", "IndexCreated"])))
    .limit(1);
  return r.length > 0;
}

/** Rows by `author` since each window, plus the latest creation time (ms columns). */
async function authorStats(
  db: Db,
  table: typeof posts | typeof postComments,
  author: string,
  windows: { short: Date; day: Date },
): Promise<{ short: number; day: number; last: Date | null }> {
  const [r] = await db
    .select({
      short: sql<number>`count(*) filter (where ${table.createdAt} >= ${windows.short.getTime()})`,
      day: sql<number>`count(*) filter (where ${table.createdAt} >= ${windows.day.getTime()})`,
      last: max(table.createdAt),
    })
    .from(table)
    .where(eq(table.author, author));
  return {
    short: Number(r?.short ?? 0),
    day: Number(r?.day ?? 0),
    last: r?.last ?? null,
  };
}

export async function postStats(
  db: Db,
  author: string,
  windows: { short: Date; day: Date },
): Promise<{ short: number; day: number; last: Date | null }> {
  return authorStats(db, posts, author, windows);
}

export async function commentStats(
  db: Db,
  author: string,
  windows: { short: Date; day: Date },
): Promise<{ short: number; day: number; last: Date | null }> {
  return authorStats(db, postComments, author, windows);
}

export async function likesSince(db: Db, wallet: string, since: Date): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(postLikes)
    .where(and(eq(postLikes.wallet, wallet), gte(postLikes.createdAt, since)));
  return r?.n ?? 0;
}

/** Same text already posted/commented by this author since `since` (duplicate check). */
export async function isDuplicate(
  db: Db,
  kind: "post" | "comment",
  author: string,
  body: string,
  since: Date,
): Promise<boolean> {
  const t = kind === "post" ? posts : postComments;
  const r = await db
    .select({ id: t.id })
    .from(t)
    // Deleted rows don't block re-posting (they still count toward rate limits).
    .where(
      and(eq(t.author, author), eq(t.body, body), gte(t.createdAt, since), isNull(t.deletedAt)),
    )
    .limit(1);
  return r.length > 0;
}

// ---------------- posts ----------------

export async function createPost(
  db: Db,
  row: { author: string; body: string; index: string | null; cardVariant?: string | null },
): Promise<PostRow> {
  return (await db.insert(posts).values(row).returning())[0] as PostRow;
}

export async function getPost(db: Db, id: number): Promise<PostRow | undefined> {
  return (
    await db
      .select()
      .from(posts)
      .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
      .limit(1)
  )[0];
}

/** Soft delete by its author. Returns false when not found / not the author. */
export async function deletePost(db: Db, id: number, author: string): Promise<boolean> {
  const r = await db
    .update(posts)
    .set({ deletedAt: new Date() })
    .where(and(eq(posts.id, id), eq(posts.author, author), isNull(posts.deletedAt)))
    .returning({ id: posts.id });
  return r.length > 0;
}

export async function listPosts(
  db: Db,
  filter: { authors?: string[]; indexes?: string[]; index?: string; author?: string },
  /** Keyset cursor: only posts with a smaller id (ids grow with creation time). */
  beforeId: number | null,
  limit: number,
): Promise<PostRow[]> {
  const scope = [];
  if (filter.authors?.length) scope.push(inList(posts.author, filter.authors));
  if (filter.indexes?.length) scope.push(inList(posts.index, filter.indexes));
  const conds = [isNull(posts.deletedAt)];
  if (beforeId !== null) conds.push(lt(posts.id, beforeId));
  if (filter.index) conds.push(eq(posts.index, filter.index));
  if (filter.author) conds.push(eq(posts.author, filter.author));
  if (scope.length) {
    const s = scope.length === 1 ? scope[0] : or(...scope);
    if (s) conds.push(s);
  }
  return db
    .select()
    .from(posts)
    .where(and(...conds))
    .orderBy(desc(posts.id))
    .limit(limit);
}

// ---------------- likes ----------------

const likeCountOf = (postId: number) =>
  sql`(select count(*) from ${postLikes} where ${postLikes.postId} = ${postId})`;
const commentCountOf = (postId: number) =>
  sql`(select count(*) from ${postComments} where ${postComments.postId} = ${postId} and ${postComments.deletedAt} is null)`;

/** Like / unlike; keeps posts.like_count in step (recounted in the same batch). Returns the new count. */
export async function setLike(
  db: Db,
  postId: number,
  wallet: string,
  like: boolean,
): Promise<number> {
  const change = like
    ? db.insert(postLikes).values({ postId, wallet }).onConflictDoNothing()
    : db.delete(postLikes).where(and(eq(postLikes.postId, postId), eq(postLikes.wallet, wallet)));
  const [, , [p]] = await db.batch([
    change,
    db
      .update(posts)
      .set({ likeCount: likeCountOf(postId) })
      .where(eq(posts.id, postId)),
    db.select({ n: posts.likeCount }).from(posts).where(eq(posts.id, postId)),
  ]);
  return p?.n ?? 0;
}

/** Post ids among `postIds` liked by `wallet`. */
export async function likedBy(db: Db, wallet: string, postIds: number[]): Promise<Set<number>> {
  if (!postIds.length) return new Set();
  const r = await db
    .select({ id: postLikes.postId })
    .from(postLikes)
    .where(and(eq(postLikes.wallet, wallet), inList(postLikes.postId, postIds)));
  return new Set(r.map((x) => x.id));
}

// ---------------- comments ----------------

export async function createComment(
  db: Db,
  row: { postId: number; author: string; body: string },
): Promise<CommentRow> {
  const [[c]] = await db.batch([
    db.insert(postComments).values(row).returning(),
    db
      .update(posts)
      .set({ commentCount: commentCountOf(row.postId) })
      .where(eq(posts.id, row.postId)),
  ]);
  return c as CommentRow;
}

export async function deleteComment(db: Db, id: number, author: string): Promise<boolean> {
  const r = await db
    .update(postComments)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(postComments.id, id), eq(postComments.author, author), isNull(postComments.deletedAt)),
    )
    .returning({ postId: postComments.postId });
  const postId = r[0]?.postId;
  if (postId === undefined) return false;
  await db
    .update(posts)
    .set({ commentCount: commentCountOf(postId) })
    .where(eq(posts.id, postId));
  return true;
}

export async function listComments(db: Db, postId: number, limit = 100): Promise<CommentRow[]> {
  return db
    .select()
    .from(postComments)
    .where(and(eq(postComments.postId, postId), isNull(postComments.deletedAt)))
    .orderBy(postComments.createdAt)
    .limit(limit);
}

// ---------------- feed scope ----------------

export async function followeesOf(db: Db, wallet: string): Promise<string[]> {
  const r = await db
    .select({ w: socialFollows.followee })
    .from(socialFollows)
    .where(eq(socialFollows.follower, wallet));
  return r.map((x) => x.w);
}

/** Indexes the wallet holds or created (their activity belongs in its Following feed). */
export async function indexesOfWallet(db: Db, wallet: string): Promise<string[]> {
  const [held, made] = await Promise.all([
    db.select({ i: positions.index }).from(positions).where(eq(positions.wallet, wallet)),
    db.select({ i: indexes.pubkey }).from(indexes).where(eq(indexes.creator, wallet)),
  ]);
  return [...new Set([...held.map((x) => x.i), ...made.map((x) => x.i)])];
}

/** On-chain activity for the feed: by wallets and/or on indexes, of the given types. */
export async function feedEvents(
  db: Db,
  filter: { wallets?: string[]; indexes?: string[]; types: string[] },
  /** Keyset cursor (ts, signature, ixIndex): several events often share one block second. */
  before: { ts: Date; signature: string; ixIndex: number } | null,
  limit: number,
): Promise<EventRow[]> {
  const scope = [];
  if (filter.wallets?.length) scope.push(inList(events.wallet, filter.wallets));
  if (filter.indexes?.length) scope.push(inList(events.index, filter.indexes));
  const conds = [inArray(events.type, filter.types)];
  if (before)
    conds.push(
      sql`(${events.ts}, ${events.signature}, ${events.ixIndex}) < (${before.ts.getTime()}, ${before.signature}, ${before.ixIndex})`,
    );
  if (scope.length) {
    const s = scope.length === 1 ? scope[0] : or(...scope);
    if (s) conds.push(s);
  }
  return db
    .select()
    .from(events)
    .where(and(...conds))
    .orderBy(desc(events.ts), desc(events.signature), desc(events.ixIndex))
    .limit(limit);
}
