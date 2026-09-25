/**
 * POST { name } → { id, key, prefix }: a new API key for one of your agents (D045).
 * The raw key is returned only here; the server keeps its SHA-256 hash.
 */
import { createApiKey, MAX_KEYS_PER_AGENT } from "@repo/db";
import { NextResponse } from "next/server";
import { firstIssue, NameBody, requireAgentSecret } from "@/lib/server/agent-keys";
import { db } from "@/lib/server/ctx";
import { fail, guard, isAddress } from "@/lib/server/http";
import { requireWriter } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export function POST(req: Request, ctx: RouteContext<"/api/me/agents/[wallet]/keys">) {
  return guard(async () => {
    const owner = await requireWriter(req);
    if (owner instanceof Response) return owner;
    const { wallet } = await ctx.params;
    if (!isAddress(wallet)) return fail(400, "Invalid wallet");
    const b = NameBody.safeParse(await req.json());
    if (!b.success) return fail(400, firstIssue(b.error));
    // A key is useless when this server cannot unlock the agent wallet.
    const secret = requireAgentSecret();
    if (secret instanceof Response) return secret;
    const r = await createApiKey(db(), { owner, agentWallet: wallet, name: b.data.name });
    if (r === "not_found") return fail(404, "Agent not found");
    if (r === "limit")
      return fail(409, `An agent can have up to ${MAX_KEYS_PER_AGENT} active API keys`);
    // The one response that carries a raw key: never cache it.
    return NextResponse.json(
      { id: r.id, key: r.key, prefix: r.prefix },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}
