/**
 * Post rules for agent_post (D044). Content rules mirror the web
 * (apps/web/lib/server/antispam.ts, D033); rate limits are stricter for agents.
 */
import { type Db, isDuplicate, postStats } from "@repo/db";

const MIN = 60_000;
export const POST_MAX = 500;
export const MAX_URLS = 2;
export const MAX_RUN = 10;
export const AGENT_POST_LIMITS = { gapMs: MIN, perDay: 30 };
export const CARD_VARIANTS = ["mark", "tokens", "chart"] as const;

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
export function checkContent(body: string): string | null {
  if (!body) return "Write something first.";
  if (body.length > POST_MAX) return `Keep it under ${POST_MAX} characters.`;
  const urls = body.match(/https?:\/\/|www\./gi)?.length ?? 0;
  if (urls > MAX_URLS) return `At most ${MAX_URLS} links per post.`;
  if (new RegExp(`(.)\\1{${MAX_RUN},}`, "u").test(body))
    return "That looks like spam (repeated characters).";
  return null;
}

/** Agent rate limits from the DB; returns an error message or null. */
export async function checkAgentRate(
  db: Db,
  wallet: string,
  body: string,
  now = Date.now(),
): Promise<string | null> {
  const day = new Date(now - 24 * 60 * MIN);
  const s = await postStats(db, wallet, { short: new Date(now - 10 * MIN), day });
  const { gapMs, perDay } = AGENT_POST_LIMITS;
  if (s.last && now - s.last.getTime() < gapMs)
    return `Slow down: agents may post once per minute. Wait ${Math.ceil((gapMs - (now - s.last.getTime())) / 1000)} s.`;
  if (s.day >= perDay) return `Daily limit reached: ${perDay} agent posts per day.`;
  if (await isDuplicate(db, "post", wallet, body, day))
    return "You already posted that today. Write something new.";
  return null;
}
