import { getIntent, setIntentParams, updateIntent } from "@repo/db";
import type { Address } from "@solana/kit";
import * as z from "zod";
import { db, serverEnv } from "@/lib/server/ctx";
import { fail, guard, isAddress } from "@/lib/server/http";
import {
  type CreateParams,
  createStep,
  joinStep,
  redeemStep,
  type StepResult,
} from "@/lib/server/steps";

const Body = z.object({ account: z.string(), step: z.number().int().min(0) });

/** Build the next step's unsigned transactions with a fresh blockhash (PLAN §7.6). */
export async function POST(req: Request, ctx: RouteContext<"/api/intents/[id]/tx">) {
  const { id } = await ctx.params;
  return guard(async () => {
    const b = Body.safeParse(await req.json());
    if (!b.success || !isAddress(b.data.account)) return fail(400, "Invalid request");
    const it = await getIntent(db(), id);
    if (!it) return fail(404, "Intent not found");
    if (new Date(it.expiresAt) < new Date())
      return fail(410, "This request expired. Ask the agent for a new one.");
    if (it.status === "executed") return fail(409, "Already executed");
    if (it.wallet && it.wallet !== b.data.account)
      return fail(403, "Connect the wallet this request was made for");
    const params = (it.params ?? {}) as Record<string, unknown>;
    const state = (params._state as Record<string, unknown>) ?? {};
    const account = b.data.account as Address;
    let r: StepResult;
    switch (it.kind) {
      case "join":
        r = await joinStep(
          account,
          params.index as Address,
          Number(params.usdc),
          b.data.step,
          state,
        );
        break;
      case "redeem":
        r = await redeemStep(
          account,
          params.index as Address,
          BigInt(String(params.shares)),
          params.toUsdc !== false,
          b.data.step,
          state,
        );
        break;
      case "create_index":
      case "clone":
        r = await createStep(
          account,
          params as unknown as CreateParams,
          b.data.step,
          state,
          serverEnv().WEB_URL,
        );
        break;
      default:
        return fail(400, `Unsupported intent kind ${it.kind}`);
    }
    await updateIntent(db(), id, { status: "in_progress", wallet: account });
    await setIntentParams(db(), id, { ...params, _state: r.state });
    return { step: r.step, label: r.label, txs: r.txs, next: r.next, summary: r.summary ?? null };
  });
}
