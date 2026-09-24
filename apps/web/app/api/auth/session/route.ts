import * as z from "zod";
import { verifyWallet } from "@/lib/server/auth";
import { fail, guard, isAddress } from "@/lib/server/http";
import { currentWallet, endSession, sameOrigin, startSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";
const Body = z.object({ wallet: z.string(), nonce: z.string(), signature: z.string() });

/** Current session wallet (null when signed out). */
export function GET() {
  return guard(async () => ({ wallet: await currentWallet() }));
}

/** Sign in: the wallet signs a one-time "sign-in" nonce; sets a 24 h httpOnly cookie. */
export function POST(req: Request) {
  return guard(async () => {
    if (!sameOrigin(req)) return fail(403, "Cross-site request blocked");
    const b = Body.safeParse(await req.json());
    if (!b.success || !isAddress(b.data.wallet)) return fail(400, "Invalid request");
    if (!(await verifyWallet(b.data.wallet, "sign-in", b.data.nonce, b.data.signature)))
      return fail(401, "Signature check failed");
    const expiresAt = await startSession(b.data.wallet);
    return { wallet: b.data.wallet, expiresAt };
  });
}

export function DELETE(req: Request) {
  return guard(async () => {
    if (!sameOrigin(req)) return fail(403, "Cross-site request blocked");
    await endSession();
    return { ok: true };
  });
}
