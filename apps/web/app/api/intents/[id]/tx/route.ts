import { getIntent, setIntentParams, updateIntent } from "@repo/db";
import type { Address } from "@solana/kit";
import * as z from "zod";
import { db, serverEnv } from "@/lib/server/ctx";
import { fail, guard, isAddress } from "@/lib/server/http";
import { LOCK_MS, paramsOf, progressOf, publicStatus } from "@/lib/server/intents";
import {
  type CreateParams,
  createStep,
  joinStep,
  MANAGE_KINDS,
  type ManageKind,
  manageStep,
  redeemStep,
  type StepResult,
} from "@/lib/server/steps";

/** `step` from older clients is ignored: the server decides which step comes next. */
const Body = z.object({ account: z.string(), step: z.number().int().min(0).optional() });

/** Build the next step's unsigned transactions with a fresh blockhash (PLAN §7.6). */
export async function POST(req: Request, ctx: RouteContext<"/api/intents/[id]/tx">) {
  const { id } = await ctx.params;
  return guard(async () => {
    const b = Body.safeParse(await req.json());
    if (!b.success || !isAddress(b.data.account)) return fail(400, "Invalid request");
    const it = await getIntent(db(), id);
    if (!it) return fail(404, "Intent not found");
    const status = publicStatus(it);
    if (status === "expired")
      return fail(410, "This request expired. Ask the agent for a new one.");
    if (status === "executed") return fail(409, "Already executed");
    if (it.wallet && it.wallet !== b.data.account)
      return fail(403, "Connect the wallet this request was made for");
    const p = progressOf(it);
    if (p.built && p.built.sigs === 0 && Date.now() - p.built.at < LOCK_MS)
      return fail(
        409,
        "This request is being signed in another tab. Finish it there or try again in a minute.",
      );
    // A step whose transactions partly landed is not rebuilt (that would swap twice): move on.
    const step = p.built && p.built.sigs > 0 && p.built.next !== null ? p.built.next : p.next;
    const params = p.rest;
    const account = b.data.account as Address;
    let r: StepResult;
    switch (it.kind) {
      case "join":
        r = await joinStep(account, params.index as Address, Number(params.usdc), step, p.state);
        break;
      case "redeem":
        r = await redeemStep(
          account,
          params.index as Address,
          BigInt(String(params.shares)),
          params.toUsdc !== false,
          step,
          p.state,
        );
        break;
      case "create_index":
      case "clone":
        r = await createStep(
          account,
          params as unknown as CreateParams,
          step,
          p.state,
          serverEnv().WEB_URL,
        );
        break;
      default:
        if (MANAGE_KINDS.includes(it.kind)) {
          r = await manageStep(account, it.kind as ManageKind, params);
          break;
        }
        return fail(400, `Unsupported intent kind ${it.kind}`);
    }
    await updateIntent(db(), id, { status: "in_progress", wallet: account });
    await setIntentParams(
      db(),
      id,
      paramsOf({
        ...p,
        state: r.state,
        next: step,
        built: { step, next: r.next, txs: r.txs.length, at: Date.now(), sigs: 0 },
      }),
    );
    return { step: r.step, label: r.label, txs: r.txs, next: r.next, summary: r.summary ?? null };
  });
}
