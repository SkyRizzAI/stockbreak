import { getIndex } from "@repo/db";
import type { Address } from "@solana/kit";
import type { NextRequest } from "next/server";
import { actionError, actionJson, b64url, preflight } from "@/lib/server/actions";
import { db, serverEnv } from "@/lib/server/ctx";
import { isAddress } from "@/lib/server/http";
import { joinStep } from "@/lib/server/steps";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/actions/join/[pubkey]">) {
  const { pubkey } = await ctx.params;
  const row = isAddress(pubkey) ? await getIndex(db(), pubkey) : undefined;
  if (!row) return actionError("Index not found", 404);
  const web = serverEnv().WEB_URL;
  const base = `/api/actions/join/${pubkey}`;
  return actionJson({
    type: "action",
    icon: `${web}/i/${pubkey}/opengraph-image`,
    title: `${row.name} (${row.symbol})`,
    description: `${row.description ?? "Tokenized stock index."} Simulated assets on ${serverEnv().CLUSTER}.`,
    label: "Join",
    links: {
      actions: [
        { type: "transaction", label: "$100", href: `${base}?amount=100` },
        { type: "transaction", label: "$500", href: `${base}?amount=500` },
        { type: "transaction", label: "$1,000", href: `${base}?amount=1000` },
        {
          type: "transaction",
          label: "Join",
          href: `${base}?amount={amount}`,
          parameters: [
            { type: "number", name: "amount", label: "USDC amount", required: true, min: 1 },
          ],
        },
      ],
    },
  });
}

/** Chained zap: this tx swaps USDC into the assets; `links.next` returns the join tx. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/actions/join/[pubkey]">) {
  const { pubkey } = await ctx.params;
  const amount = Number(req.nextUrl.searchParams.get("amount"));
  if (!isAddress(pubkey) || !(amount > 0)) return actionError("Invalid index or amount");
  let account: string | undefined;
  try {
    account = ((await req.json()) as { account?: string }).account;
  } catch {
    return actionError("Invalid body");
  }
  if (!isAddress(account)) return actionError("Invalid account");
  try {
    const r = await joinStep(account as Address, pubkey as Address, amount, 0, {});
    const state = b64url(r.state);
    const [first] = r.txs;
    const n = r.txs.length;
    if (!first) {
      const j = await joinStep(account as Address, pubkey as Address, amount, 1, r.state);
      return actionJson({
        type: "transaction",
        transaction: j.txs[0],
        message: `Join with $${amount} USDC`,
      });
    }
    return actionJson({
      type: "transaction",
      transaction: first,
      message: `Swap 1 of ${n}: USDC into the index assets`,
      links: {
        next: {
          type: "post",
          href: `/api/actions/join/${pubkey}/next?amount=${amount}&k=1&n=${n}&state=${state}`,
        },
      },
    });
  } catch (e) {
    return actionError(e instanceof Error ? (e.message.split("\n")[0] ?? "Failed") : "Failed", 500);
  }
}
