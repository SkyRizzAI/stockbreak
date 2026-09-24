import type { NextRequest } from "next/server";
import { actionJson, preflight } from "@/lib/server/actions";
import { serverEnv } from "@/lib/server/ctx";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Chaining callback (`links.next`): returns the next action with one button. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/actions/join/[pubkey]/next">) {
  const { pubkey } = await ctx.params;
  const p = req.nextUrl.searchParams;
  const k = Number(p.get("k") ?? "1");
  const n = Number(p.get("n") ?? "1");
  const final = k >= n;
  const qs = `amount=${p.get("amount")}&k=${k}&n=${n}&state=${p.get("state")}`;
  return actionJson({
    type: "action",
    icon: `${serverEnv().WEB_URL}/i/${pubkey}/opengraph-image`,
    title: final ? "Deposit into the index" : `Swap ${k + 1} of ${n}`,
    description: final
      ? "Join with the assets you just bought."
      : "Continue swapping USDC into the index assets.",
    label: final ? "Join" : "Continue",
    links: {
      actions: [
        {
          type: "transaction",
          label: final ? "Join" : "Continue",
          href: `/api/actions/join/${pubkey}/tx?${qs}`,
        },
      ],
    },
  });
}
