/** DELETE → { ok: true }: revoke one of your agents' API keys (D045). */
import { revokeApiKey } from "@repo/db";
import { db } from "@/lib/server/ctx";
import { fail, guard } from "@/lib/server/http";
import { requireWriter } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export function DELETE(req: Request, ctx: RouteContext<"/api/me/keys/[id]">) {
  return guard(async () => {
    const owner = await requireWriter(req);
    if (owner instanceof Response) return owner;
    const { id } = await ctx.params;
    const n = Number(id);
    if (!/^\d{1,9}$/.test(id) || !Number.isSafeInteger(n) || n <= 0)
      return fail(400, "Invalid key id");
    if (!(await revokeApiKey(db(), owner, n))) return fail(404, "Key not found");
    return { ok: true };
  });
}
