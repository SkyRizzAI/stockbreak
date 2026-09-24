import "server-only";
/** Content and rate rules for posts, comments and likes (PLAN §7.7, D033). */
import { commentStats, hasOnchainActivity, isDuplicate, likesSince, postStats } from "@repo/db";
import { db } from "./ctx";

const MIN = 60_000;
export const LIMITS = {
  post: { max: 500, perWindow: 3, windowMs: 10 * MIN, perDay: 20, gapMs: 20_000 },
  comment: { max: 280, perWindow: 10, windowMs: 10 * MIN, perDay: 100, gapMs: 5_000 },
  like: { perWindow: 120, windowMs: 10 * MIN },
  maxUrls: 2,
  maxRun: 10,
};

/** Trim, collapse runs of spaces, keep at most two consecutive line breaks. */
export function normalizeBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Content check; returns an error message or null. */
export function checkContent(body: string, kind: "post" | "comment"): string | null {
  const max = LIMITS[kind].max;
  if (!body) return "Write something first.";
  if (body.length > max) return `Keep it under ${max} characters.`;
  const urls = body.match(/https?:\/\/|www\./gi)?.length ?? 0;
  if (urls > LIMITS.maxUrls) return `At most ${LIMITS.maxUrls} links per ${kind}.`;
  if (new RegExp(`(.)\\1{${LIMITS.maxRun},}`, "u").test(body))
    return "That looks like spam (repeated characters).";
  return null;
}

/** Post/comment rules for a wallet; returns an error message or null. */
export async function checkWriter(
  wallet: string,
  kind: "post" | "comment",
  body: string,
): Promise<string | null> {
  const d = db();
  if (!(await hasOnchainActivity(d, wallet)))
    return "Join or create an index first — posting needs on-chain activity.";
  const L = LIMITS[kind];
  const now = Date.now();
  const s = await (kind === "post" ? postStats : commentStats)(d, wallet, {
    short: new Date(now - L.windowMs),
    day: new Date(now - 24 * 60 * MIN),
  });
  if (s.last && now - s.last.getTime() < L.gapMs)
    return `Slow down — wait ${Math.ceil((L.gapMs - (now - s.last.getTime())) / 1000)} s.`;
  if (s.short >= L.perWindow) return `Limit reached: ${L.perWindow} ${kind}s per 10 minutes.`;
  if (s.day >= L.perDay) return `Daily limit reached: ${L.perDay} ${kind}s per day.`;
  if (await isDuplicate(d, kind, wallet, body, new Date(now - 24 * 60 * MIN)))
    return `You already posted that ${kind === "post" ? "" : "comment "}today.`.replace("  ", " ");
  return null;
}

export async function checkLiker(wallet: string): Promise<string | null> {
  const n = await likesSince(db(), wallet, new Date(Date.now() - LIMITS.like.windowMs));
  return n >= LIMITS.like.perWindow ? "Too many likes — try again later." : null;
}
