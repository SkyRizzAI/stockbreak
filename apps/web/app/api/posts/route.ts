import { createPost, getIndex, listPosts } from "@repo/db";
import type { NextRequest } from "next/server";
import * as z from "zod";
import { checkContent, checkWriter, normalizeBody } from "@/lib/server/antispam";
import { db } from "@/lib/server/ctx";
import { toPostItems } from "@/lib/server/feed";
import { fail, guard, isAddress } from "@/lib/server/http";
import { requireWriter } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** GET /api/posts?index=<pubkey>|author=<wallet>&viewer=<wallet>&before=<iso> */
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
  const before = p.get("before")
    ? new Date(p.get("before") as string)
    : new Date(Date.now() + 60_000);
  return guard(async () => {
    const rows = await listPosts(
      db(),
      { index: index ?? undefined, author: author ?? undefined },
      before,
      30,
    );
    return {
      items: await toPostItems(rows, viewer),
      next: rows.length === 30 ? (rows.at(-1)?.createdAt.toISOString() ?? null) : null,
    };
  });
}

const Body = z.object({ body: z.string().max(2_000), index: z.string().nullish() });

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
    if (index && (!isAddress(index) || !(await getIndex(db(), index))))
      return fail(400, "Unknown index");
    const limited = await checkWriter(who, "post", body);
    if (limited) return fail(429, limited);
    const row = await createPost(db(), { author: who, body, index });
    return (await toPostItems([row], who))[0];
  });
}
