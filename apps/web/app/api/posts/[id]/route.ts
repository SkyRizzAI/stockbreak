import { deletePost } from "@repo/db";
import { db } from "@/lib/server/ctx";
import { fail, guard } from "@/lib/server/http";
import { requireWriter } from "@/lib/server/session";

export async function DELETE(req: Request, ctx: RouteContext<"/api/posts/[id]">) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return fail(400, "Invalid post");
  return guard(async () => {
    const who = await requireWriter(req);
    if (typeof who !== "string") return who;
    if (!(await deletePost(db(), id, who))) return fail(404, "Post not found");
    return { ok: true };
  });
}
