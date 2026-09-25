import { ensureUser, handleTaken, updateUser } from "@repo/db";
import type { NextRequest } from "next/server";
import * as z from "zod";
import { verifyWallet } from "@/lib/server/auth";
import { db } from "@/lib/server/ctx";
import { profile } from "@/lib/server/data";
import { fail, guard, isAddress } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: RouteContext<"/api/users/[wallet]">) {
  const { wallet } = await ctx.params;
  if (!isAddress(wallet)) return fail(400, "Invalid wallet");
  const viewer = req.nextUrl.searchParams.get("viewer") ?? undefined;
  return guard(() => profile(wallet, isAddress(viewer) ? viewer : undefined));
}

const RESERVED = new Set([
  "admin",
  "stocklana",
  "stockbreak",
  "keeper",
  "system",
  "support",
  "official",
  "moderator",
  "platform",
]);

const Body = z.object({
  handle: z
    .string()
    .regex(/^[a-z0-9_]{3,20}$/, "Handle: 3–20 characters, a–z, 0–9 or _")
    .nullable(),
  bio: z.string().max(160).nullable(),
  nonce: z.string(),
  signature: z.string(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/users/[wallet]">) {
  const { wallet } = await ctx.params;
  if (!isAddress(wallet)) return fail(400, "Invalid wallet");
  return guard(async () => {
    const b = Body.safeParse(await req.json());
    if (!b.success) return fail(400, b.error.issues[0]?.message ?? "Invalid request");
    if (!(await verifyWallet(wallet, "profile", b.data.nonce, b.data.signature)))
      return fail(401, "Signature check failed");
    if (b.data.handle && RESERVED.has(b.data.handle)) return fail(409, "That handle is reserved");
    if (b.data.handle && (await handleTaken(db(), b.data.handle, wallet)))
      return fail(409, "Handle is taken");
    await ensureUser(db(), wallet);
    try {
      return await updateUser(db(), wallet, { handle: b.data.handle, bio: b.data.bio });
    } catch (e) {
      // Two wallets racing for one handle: the unique index decides.
      if (/unique|duplicate/i.test(String((e as { message?: string }).message)))
        return fail(409, "Handle is taken");
      throw e;
    }
  });
}
