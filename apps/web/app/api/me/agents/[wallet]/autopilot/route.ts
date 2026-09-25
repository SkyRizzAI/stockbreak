/**
 * Hosted autopilot of one of your agents (D047).
 * GET → AutopilotView (settings, availability, last 10 runs newest first).
 * PUT { enabled?, intervalMinutes? (5–1440), strategy? (≤1000), indexes? (≤10 addresses) }
 *   → AutopilotView. Turning it on schedules a run now.
 */
import { saveAutopilot } from "@repo/db";
import { firstIssue, requireOwner } from "@/lib/server/agent-keys";
import { AutopilotBody, autopilotView, ownedAgent } from "@/lib/server/autopilot";
import { db } from "@/lib/server/ctx";
import { fail, guard } from "@/lib/server/http";
import { requireWriter } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export function GET(_req: Request, ctx: RouteContext<"/api/me/agents/[wallet]/autopilot">) {
  return guard(async () => {
    const owner = await requireOwner();
    if (owner instanceof Response) return owner;
    const wallet = await ownedAgent(owner, (await ctx.params).wallet);
    if (wallet instanceof Response) return wallet;
    return autopilotView(wallet);
  });
}

export function PUT(req: Request, ctx: RouteContext<"/api/me/agents/[wallet]/autopilot">) {
  return guard(async () => {
    const owner = await requireWriter(req);
    if (owner instanceof Response) return owner;
    const wallet = await ownedAgent(owner, (await ctx.params).wallet);
    if (wallet instanceof Response) return wallet;
    const b = AutopilotBody.safeParse(await req.json());
    if (!b.success) return fail(400, firstIssue(b.error));
    await saveAutopilot(db(), wallet, b.data);
    return autopilotView(wallet);
  });
}
