import type { NextRequest } from "next/server";
import { feed } from "@/lib/server/feed";
import { fail, guard, isAddress } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/feed?tab=all|following&viewer=<wallet>&before=<iso>&limit=30 */
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const tab = p.get("tab") === "following" ? "following" : "all";
  const viewer = p.get("viewer");
  if (viewer && !isAddress(viewer)) return fail(400, "Invalid viewer");
  const before = p.get("before")
    ? new Date(p.get("before") as string)
    : new Date(Date.now() + 60_000);
  if (Number.isNaN(before.getTime())) return fail(400, "Invalid cursor");
  const limit = Math.min(50, Math.max(1, Number(p.get("limit") ?? 30)));
  return guard(() => feed({ tab, viewer: viewer || null, before, limit }));
}
