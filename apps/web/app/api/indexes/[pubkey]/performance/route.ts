import type { NextRequest } from "next/server";
import { performance, type Range } from "@/lib/server/data";
import { fail, guard, isAddress } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/indexes/[pubkey]/performance">,
) {
  const { pubkey } = await ctx.params;
  if (!isAddress(pubkey)) return fail(400, "Invalid index address");
  const r = (req.nextUrl.searchParams.get("range") ?? "1M").toUpperCase();
  const range = (["1D", "1W", "1M", "ALL"].includes(r) ? r : "1M") as Range;
  return guard(() => performance(pubkey, range));
}
