import { getPost, setLike } from "@repo/db";
import * as z from "zod";
import { checkLiker } from "@/lib/server/antispam";
import { db } from "@/lib/server/ctx";
import { fail, guard } from "@/lib/server/http";
import { requireWriter } from "@/lib/server/session";

const Body = z.object({ like: z.boolean() });

export async function POST(req: Request, ctx: RouteContext<"/api/posts/[id]/like">) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return fail(400, "Invalid post");
  return guard(async () => {
    const who = await requireWriter(req);
    if (typeof who !== "string") return who;
    const b = Body.safeParse(await req.json());
    if (!b.success) return fail(400, "Invalid request");
    if (!(await getPost(db(), id))) return fail(404, "Post not found");
    if (b.data.like) {
      const limited = await checkLiker(who);
      if (limited) return fail(429, limited);
    }
    return { likes: await setLike(db(), id, who, b.data.like), liked: b.data.like };
  });
}
