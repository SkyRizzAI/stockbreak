/**
 * POST { asset?: "SOL" | "USDC", amount?: number } — fund one of your agents.
 * SOL (default) → { ok, sol }: fees (D045), same rules as /api/faucet/sol.
 * USDC → { ok, usdc, signature }: simulated USDC minted by the agent itself through the
 * mock market faucet (D046); needs SOL for the fee, capped per request and per day.
 */
import { CLUSTER_PARAMS } from "@repo/config";
import { decryptSecret, getAgentWallet } from "@repo/db";
import {
  type Address,
  createKeyPairSignerFromPrivateKeyBytes,
  type KeyPairSigner,
} from "@solana/kit";
import * as z from "zod";
import { firstIssue, requireAgentSecret } from "@/lib/server/agent-keys";
import { db, serverEnv } from "@/lib/server/ctx";
import { AGENT_USDC_DAILY_CAP, faucetSol, faucetUsdcForAgent } from "@/lib/server/faucet";
import { fail, guard, isAddress } from "@/lib/server/http";
import { requireWriter } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const Body = z.object({
  asset: z.enum(["SOL", "USDC"]).default("SOL"),
  amount: z.number().positive("Amount must be above 0").optional(),
});

export function POST(req: Request, ctx: RouteContext<"/api/me/agents/[wallet]/fund">) {
  return guard(async () => {
    const owner = await requireWriter(req);
    if (owner instanceof Response) return owner;
    const { wallet } = await ctx.params;
    if (!isAddress(wallet)) return fail(400, "Invalid wallet");
    // An empty body keeps the original behaviour (SOL).
    const raw = await req.text();
    const parsed = Body.safeParse(raw.trim() ? JSON.parse(raw) : {});
    if (!parsed.success) return fail(400, firstIssue(parsed.error));
    const a = await getAgentWallet(db(), wallet);
    if (!a || a.owner !== owner) return fail(404, "Agent not found");
    if (parsed.data.asset === "SOL") {
      const r = await faucetSol(a.wallet as Address);
      return r instanceof Response ? r : { ok: true, sol: r.sol };
    }
    const max = Math.min(
      Number(CLUSTER_PARAMS[serverEnv().CLUSTER].faucetMaxUsdc / 1_000_000n),
      AGENT_USDC_DAILY_CAP,
    );
    const usdc = parsed.data.amount ?? Math.min(1_000, max);
    if (usdc > max) return fail(400, `At most ${max.toLocaleString("en-US")} USDC per request`);
    const secret = requireAgentSecret();
    if (secret instanceof Response) return secret;
    let signer: KeyPairSigner;
    try {
      signer = await createKeyPairSignerFromPrivateKeyBytes(decryptSecret(a.secretEnc, secret));
    } catch {
      // Wrong AGENT_KEY_SECRET or a corrupted row. Never log the key.
      return fail(503, "This agent's wallet cannot be unlocked on this server");
    }
    if (signer.address !== a.wallet)
      return fail(503, "This agent's wallet cannot be unlocked on this server");
    const r = await faucetUsdcForAgent(signer, usdc);
    return r instanceof Response ? r : { ok: true, usdc: r.usdc, signature: r.signature };
  });
}
