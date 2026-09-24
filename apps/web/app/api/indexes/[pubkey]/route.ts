import { indexDetail } from "@/lib/server/data";
import { fail, guard, isAddress } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/indexes/[pubkey]">) {
  const { pubkey } = await ctx.params;
  if (!isAddress(pubkey)) return fail(400, "Invalid index address");
  return guard(async () => (await indexDetail(pubkey)) ?? fail(404, "Index not found"));
}
