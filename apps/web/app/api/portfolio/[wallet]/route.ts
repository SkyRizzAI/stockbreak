import { portfolio } from "@/lib/server/data";
import { fail, guard, isAddress } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/portfolio/[wallet]">) {
  const { wallet } = await ctx.params;
  if (!isAddress(wallet)) return fail(400, "Invalid wallet");
  return guard(() => portfolio(wallet));
}
