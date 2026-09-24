import { getIntent, updateIntent } from "@repo/db";
import * as z from "zod";
import { db } from "@/lib/server/ctx";
import { fail, guard } from "@/lib/server/http";

const Body = z.object({
  signatures: z.array(z.string()),
  done: z.boolean(),
  error: z.string().nullable().optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/intents/[id]/status">) {
  const { id } = await ctx.params;
  return guard(async () => {
    const b = Body.safeParse(await req.json());
    if (!b.success) return fail(400, "Invalid request");
    const it = await getIntent(db(), id);
    if (!it) return fail(404, "Intent not found");
    const sigs = [...((it.signatures as string[]) ?? []), ...b.data.signatures];
    await updateIntent(db(), id, {
      signatures: sigs,
      status: b.data.error ? "failed" : b.data.done ? "executed" : "in_progress",
    });
    return { ok: true };
  });
}
