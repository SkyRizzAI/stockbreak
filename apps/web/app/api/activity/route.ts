import type { NextRequest } from "next/server";
import { activity } from "@/lib/server/data";
import { guard, isAddress } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  return guard(() => activity(isAddress(wallet) ? { wallet } : {}, 40));
}
