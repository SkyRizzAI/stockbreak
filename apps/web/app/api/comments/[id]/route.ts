import { deleteComment } from "@repo/db";
import { db } from "@/lib/server/ctx";
import { fail, guard } from "@/lib/server/http";
import { requireWriter } from "@/lib/server/session";

export async function DELETE(req: Request, ctx: RouteContext<"/api/comments/[id]">) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) return fail(400, "Invalid comment");
  return guard(async () => {
    const who = await requireWriter(req);
    if (typeof who !== "string") return who;
    if (!(await deleteComment(db(), id, who))) return fail(404, "Comment not found");
    return { ok: true };
  });
}
