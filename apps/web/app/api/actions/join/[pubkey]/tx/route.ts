import type { Address } from "@solana/kit";
import type { NextRequest } from "next/server";
import { actionError, actionJson, fromB64url, preflight } from "@/lib/server/actions";
import { isAddress } from "@/lib/server/http";
import { joinStep } from "@/lib/server/steps";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Transaction k of the chain: remaining swap txs, then the join tx. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/actions/join/[pubkey]/tx">) {
  const { pubkey } = await ctx.params;
  const p = req.nextUrl.searchParams;
  const amount = Number(p.get("amount"));
  const k = Number(p.get("k") ?? "1");
  const n = Number(p.get("n") ?? "1");
  const state = fromB64url<Record<string, unknown>>(p.get("state"));
  let account: string | undefined;
  try {
    account = ((await req.json()) as { account?: string }).account;
  } catch {
    return actionError("Invalid body");
  }
  if (!isAddress(pubkey) || !isAddress(account) || !state || !(amount > 0))
    return actionError("Invalid request");
  try {
    if (k < n) {
      const r = await joinStep(account as Address, pubkey as Address, amount, 0, {});
      const tx = r.txs[k];
      if (!tx) return actionError("Nothing left to swap");
      return actionJson({
        type: "transaction",
        transaction: tx,
        message: `Swap ${k + 1} of ${n}`,
        links: {
          next: {
            type: "post",
            href: `/api/actions/join/${pubkey}/next?amount=${amount}&k=${k + 1}&n=${n}&state=${p.get("state")}`,
          },
        },
      });
    }
    const j = await joinStep(account as Address, pubkey as Address, amount, 1, state);
    return actionJson({
      type: "transaction",
      transaction: j.txs[0],
      message: `Joined with $${amount} USDC`,
    });
  } catch (e) {
    return actionError(e instanceof Error ? (e.message.split("\n")[0] ?? "Failed") : "Failed", 500);
  }
}
