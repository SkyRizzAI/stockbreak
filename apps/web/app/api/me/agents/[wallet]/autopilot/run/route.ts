/**
 * POST → { queued: true }: run one autopilot cycle of your agent on the worker's next tick
 * (also when autopilot is off). 409 while a run is pending, 429 above 1 per 5 minutes,
 * 503 when no worker can run autopilot (D047).
 */
import { requestAutopilotRun } from "@repo/db";
import { NextResponse } from "next/server";
import { autopilotAvailability, ownedAgent } from "@/lib/server/autopilot";
import { db } from "@/lib/server/ctx";
import { fail, guard } from "@/lib/server/http";
import { requireWriter } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export function POST(req: Request, ctx: RouteContext<"/api/me/agents/[wallet]/autopilot/run">) {
  return guard(async () => {
    const owner = await requireWriter(req);
    if (owner instanceof Response) return owner;
    const wallet = await ownedAgent(owner, (await ctx.params).wallet);
    if (wallet instanceof Response) return wallet;
    const avail = await autopilotAvailability();
    if (!avail.available) return fail(503, avail.reason ?? "Autopilot is not available");
    const r = await requestAutopilotRun(db(), wallet);
    if (r.status === "running") return fail(409, "A run is already queued or in progress");
    if (r.status === "rate_limited")
      return NextResponse.json(
        { error: `You can start one run every 5 minutes. Try again in ${r.retryAfterSecs} s.` },
        { status: 429, headers: { "Retry-After": String(r.retryAfterSecs) } },
      );
    return { queued: true };
  });
}
