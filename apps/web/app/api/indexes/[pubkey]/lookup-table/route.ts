import * as z from "zod";
import { fail, guard, isAddress } from "@/lib/server/http";
import { saveLookupTable } from "@/lib/server/index-row";

const Body = z.object({ lookupTable: z.string() });

/** Record the lookup table the creator built for a large index (validated on chain). */
export async function POST(req: Request, ctx: RouteContext<"/api/indexes/[pubkey]/lookup-table">) {
  const { pubkey } = await ctx.params;
  if (!isAddress(pubkey)) return fail(400, "Invalid index address");
  return guard(async () => {
    const b = Body.safeParse(await req.json());
    if (!b.success || !isAddress(b.data.lookupTable)) return fail(400, "Invalid lookup table");
    if (!(await saveLookupTable(pubkey, b.data.lookupTable)))
      return fail(422, "This lookup table does not cover the index");
    return { ok: true };
  });
}
