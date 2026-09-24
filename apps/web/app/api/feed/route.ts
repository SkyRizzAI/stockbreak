import type { NextRequest } from "next/server";
import { decodeCursor, feed } from "@/lib/server/feed";
import { fail, guard, intParam, isAddress } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/feed?tab=all|following&viewer=<wallet>&cursor=<opaque>&limit=30 */
export function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const tab = p.get("tab") === "following" ? "following" : "all";
  const viewer = p.get("viewer");
  if (viewer && !isAddress(viewer)) return fail(400, "Invalid viewer");
  const cursor = decodeCursor(p.get("cursor"));
  if (cursor === "invalid") return fail(400, "Invalid cursor");
  const limit = intParam(p.get("limit"), 30, 1, 50);
  return guard(() => feed({ tab, viewer: viewer || null, cursor, limit }));
}
