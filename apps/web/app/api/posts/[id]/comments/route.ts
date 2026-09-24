import { createComment, getPost, listComments } from "@repo/db";
import * as z from "zod";
import { checkContent, checkWriter, normalizeBody } from "@/lib/server/antispam";
import { db } from "@/lib/server/ctx";
import { toCommentItems } from "@/lib/server/feed";
import { fail, guard } from "@/lib/server/http";
import { requireWriter } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/posts/[id]/comments">) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return fail(400, "Invalid post");
  return guard(async () => toCommentItems(await listComments(db(), id)));
}

const Body = z.object({ body: z.string().max(2_000) });

export async function POST(req: Request, ctx: RouteContext<"/api/posts/[id]/comments">) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return fail(400, "Invalid post");
  return guard(async () => {
    const who = await requireWriter(req);
    if (typeof who !== "string") return who;
    const b = Body.safeParse(await req.json());
    if (!b.success) return fail(400, "Invalid request");
    if (!(await getPost(db(), id))) return fail(404, "Post not found");
    const body = normalizeBody(b.data.body);
    const bad = checkContent(body, "comment");
    if (bad) return fail(400, bad);
    const limited = await checkWriter(who, "comment", body);
    if (limited) return fail(429, limited);
    const row = await createComment(db(), { postId: id, author: who, body });
    return (await toCommentItems([row]))[0];
  });
}
