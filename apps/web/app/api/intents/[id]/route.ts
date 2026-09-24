import { getIntent } from "@repo/db";
import { db } from "@/lib/server/ctx";
import { fail, guard } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/intents/[id]">) {
  const { id } = await ctx.params;
  return guard(async () => {
    const it = await getIntent(db(), id);
    if (!it) return fail(404, "Intent not found");
    const { _state, ...params } = (it.params ?? {}) as Record<string, unknown>;
    void _state;
    return {
      id: it.id,
      kind: it.kind,
      params,
      wallet: it.wallet,
      createdBy: it.createdBy,
      status:
        new Date(it.expiresAt) < new Date() && it.status === "pending" ? "expired" : it.status,
      signatures: it.signatures,
      createdAt: it.createdAt,
      expiresAt: it.expiresAt,
    };
  });
}
