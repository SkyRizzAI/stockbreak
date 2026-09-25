/**
 * POST → { ok, sol }: SOL for one of your agents' fees (D045). Same rules as
 * /api/faucet/sol (localnet airdrop; devnet admin transfer with per-wallet and daily limits).
 */
import { getAgentWallet } from "@repo/db";
import type { Address } from "@solana/kit";
import { db } from "@/lib/server/ctx";
import { faucetSol } from "@/lib/server/faucet";
import { fail, guard, isAddress } from "@/lib/server/http";
import { requireWriter } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export function POST(req: Request, ctx: RouteContext<"/api/me/agents/[wallet]/fund">) {
  return guard(async () => {
    const owner = await requireWriter(req);
    if (owner instanceof Response) return owner;
    const { wallet } = await ctx.params;
    if (!isAddress(wallet)) return fail(400, "Invalid wallet");
    const a = await getAgentWallet(db(), wallet);
    if (!a || a.owner !== owner) return fail(404, "Agent not found");
    const r = await faucetSol(a.wallet as Address);
    return r instanceof Response ? r : { ok: true, sol: r.sol };
  });
}
