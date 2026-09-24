import { createNonce } from "@repo/db";
import type { NextRequest } from "next/server";
import { authMessage } from "@/lib/auth-message";
import { db } from "@/lib/server/ctx";
import { fail, guard, isAddress } from "@/lib/server/http";

export const dynamic = "force-dynamic";
const PURPOSES = new Set(["profile", "follow", "index-meta", "agent-register", "sign-in"]);

export function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  const purpose = req.nextUrl.searchParams.get("purpose") ?? "";
  if (!isAddress(wallet) || !PURPOSES.has(purpose)) return fail(400, "Invalid wallet or purpose");
  return guard(async () => {
    const nonce = await createNonce(db(), wallet, purpose);
    return { nonce, message: authMessage(wallet, purpose, nonce) };
  });
}
