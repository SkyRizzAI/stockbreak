import { ASSETS } from "@repo/config";
import { searchIndexes } from "@repo/db";
import type { NextRequest } from "next/server";
import { db } from "@/lib/server/ctx";
import { guard } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  return guard(async () => {
    if (!q) return { indexes: [], assets: [], creators: [] };
    const d = db();
    const indexes = await searchIndexes(d, q, 8);
    const creators = await d.query.users.findMany({
      where: (t, { ilike, or }) => or(ilike(t.handle, `%${q}%`), ilike(t.wallet, `${q}%`)),
      limit: 6,
    });
    const ql = q.toLowerCase();
    const assets = ASSETS.filter(
      (a) => a.symbol.toLowerCase().includes(ql) || a.name.toLowerCase().includes(ql),
    ).slice(0, 8);
    return {
      indexes: indexes.map((i) => ({ pubkey: i.pubkey, name: i.name, symbol: i.symbol })),
      assets: assets.map((a) => ({ symbol: a.symbol, name: a.name, kind: a.kind })),
      creators: creators.map((u) => ({ wallet: u.wallet, handle: u.handle, isAgent: u.isAgent })),
    };
  });
}
