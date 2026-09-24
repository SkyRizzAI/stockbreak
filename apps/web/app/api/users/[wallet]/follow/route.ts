import { setFollow } from "@repo/db";
import * as z from "zod";
import { verifyWallet } from "@/lib/server/auth";
import { db } from "@/lib/server/ctx";
import { fail, guard, isAddress } from "@/lib/server/http";

const Body = z.object({
  follower: z.string(),
  follow: z.boolean(),
  nonce: z.string(),
  signature: z.string(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/users/[wallet]/follow">) {
  const { wallet } = await ctx.params;
  if (!isAddress(wallet)) return fail(400, "Invalid wallet");
  return guard(async () => {
    const b = Body.safeParse(await req.json());
    if (!b.success || !isAddress(b.data.follower)) return fail(400, "Invalid request");
    if (b.data.follower === wallet) return fail(400, "You cannot follow yourself");
    if (!(await verifyWallet(b.data.follower, "follow", b.data.nonce, b.data.signature)))
      return fail(401, "Signature check failed");
    await setFollow(db(), b.data.follower, wallet, b.data.follow);
    return { ok: true };
  });
}
