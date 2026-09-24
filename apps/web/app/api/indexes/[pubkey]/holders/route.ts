import { holders } from "@/lib/server/data";
import { fail, guard, isAddress } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/indexes/[pubkey]/holders">) {
  const { pubkey } = await ctx.params;
  if (!isAddress(pubkey)) return fail(400, "Invalid index address");
  return guard(() => holders(pubkey));
}
