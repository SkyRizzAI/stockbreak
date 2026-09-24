import { createPost, listPosts } from "@repo/db";
import type { NextRequest } from "next/server";
import * as z from "zod";
import { checkContent, checkWriter, normalizeBody } from "@/lib/server/antispam";
import { db } from "@/lib/server/ctx";
import { toPostItems } from "@/lib/server/feed";
import { fail, guard, isAddress } from "@/lib/server/http";
import { ensureIndexRow } from "@/lib/server/index-row";
import { requireWriter } from "@/lib/server/session";
import { CARD_VARIANTS } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/posts?index=<pubkey>|author=<wallet>&viewer=<wallet>&cursor=<post id> */
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const index = p.get("index");
  const author = p.get("author");
  const viewer = p.get("viewer");
  if (
    (index && !isAddress(index)) ||
    (author && !isAddress(author)) ||
    (viewer && !isAddress(viewer))
  )
    return fail(400, "Invalid address");
  const cursor = p.get("cursor");
  if (cursor && !/^\d{1,12}$/.test(cursor)) return fail(400, "Invalid cursor");
  return guard(async () => {
    const rows = await listPosts(
      db(),
      { index: index ?? undefined, author: author ?? undefined },
      cursor ? Number(cursor) : null,
      30,
    );
    return {
      items: await toPostItems(rows, viewer),
      next: rows.length === 30 ? String(rows.at(-1)?.id) : null,
    };
  });
}

const Body = z.object({
  body: z.string().max(2_000),
  index: z.string().nullish(),
  cardVariant: z.enum(CARD_VARIANTS).nullish(),
});

/** Create a post (signed-in session + anti-spam rules). */
export async function POST(req: Request) {
  return guard(async () => {
    const who = await requireWriter(req);
    if (typeof who !== "string") return who;
    const b = Body.safeParse(await req.json());
    if (!b.success) return fail(400, "Invalid request");
    const body = normalizeBody(b.data.body);
    const bad = checkContent(body, "post");
    if (bad) return fail(400, bad);
    const index = b.data.index || null;
    // Chain fallback: the index may be seconds old and not indexed yet.
    if (index && (!isAddress(index) || !(await ensureIndexRow(index).catch(() => undefined))))
      return fail(400, "Unknown index");
    const limited = await checkWriter(who, "post", body);
    if (limited) return fail(429, limited);
    // A card look only makes sense with an attached index.
    const cardVariant = index ? (b.data.cardVariant ?? null) : null;
    const row = await createPost(db(), { author: who, body, index, cardVariant });
    return (await toPostItems([row], who))[0];
  });
}
