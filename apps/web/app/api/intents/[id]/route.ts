import { getIntent } from "@repo/db";
import { db } from "@/lib/server/ctx";
import { fail, guard } from "@/lib/server/http";
import { progressOf, publicStatus } from "@/lib/server/intents";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/intents/[id]">) {
  const { id } = await ctx.params;
  return guard(async () => {
    const it = await getIntent(db(), id);
    if (!it) return fail(404, "Intent not found");
    const p = progressOf(it);
    const created = p.state.index as string | undefined;
    return {
      id: it.id,
      kind: it.kind,
      params: p.rest,
      wallet: it.wallet,
      createdBy: it.createdBy,
      status: publicStatus(it),
      signatures: it.signatures,
      /** Steps already finished; > 0 means /sign resumes instead of starting over. */
      resumed: p.next > 0 || (p.built?.sigs ?? 0) > 0,
      result: created ? { index: created } : null,
      createdAt: it.createdAt,
      expiresAt: it.expiresAt,
    };
  });
}
