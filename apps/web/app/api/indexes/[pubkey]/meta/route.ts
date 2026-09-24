import { setIndexMeta } from "@repo/db";
import * as z from "zod";
import { verifyWallet } from "@/lib/server/auth";
import { db } from "@/lib/server/ctx";
import { fail, guard, isAddress } from "@/lib/server/http";
import { ensureIndexRow } from "@/lib/server/index-row";

const Body = z.object({
  description: z.string().max(280).nullable(),
  thesis: z.string().max(1000).nullable(),
  wallet: z.string(),
  nonce: z.string(),
  signature: z.string(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/indexes/[pubkey]/meta">) {
  const { pubkey } = await ctx.params;
  if (!isAddress(pubkey)) return fail(400, "Invalid index address");
  return guard(async () => {
    const b = Body.safeParse(await req.json());
    if (!b.success) return fail(400, "Invalid request");
    // Right after create the worker may not have indexed it yet: sync from chain.
    const row = await ensureIndexRow(pubkey);
    if (!row) return fail(404, "Index not found");
    if (row.creator !== b.data.wallet) return fail(403, "Only the creator can edit this index");
    if (!(await verifyWallet(b.data.wallet, "index-meta", b.data.nonce, b.data.signature)))
      return fail(401, "Signature check failed");
    await setIndexMeta(db(), pubkey, { description: b.data.description, thesis: b.data.thesis });
    return { ok: true };
  });
}
