import type { NextRequest } from "next/server";
import { benchmarkReturns, indexSummaries } from "@/lib/server/data";
import { guard } from "@/lib/server/http";
import type { IndexSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

const SORTS: Record<string, (a: IndexSummary, b: IndexSummary) => number> = {
  return: (a, b) => (b.ret7d ?? -1e9) - (a.ret7d ?? -1e9),
  aum: (a, b) => b.navUsd - a.navUsd,
  holders: (a, b) => b.holders - a.holders,
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
};

export function GET(req: NextRequest) {
  return guard(async () => {
    const p = req.nextUrl.searchParams;
    const q = (p.get("q") ?? "").trim().toLowerCase();
    const type = p.get("type") ?? "all";
    const preIpo = p.get("preipo") === "1";
    const strategy = p.get("strategy");
    const sort = SORTS[p.get("sort") ?? "aum"] ?? SORTS.aum;
    const limit = Math.min(100, Number(p.get("limit") ?? 50));
    const page = Math.max(0, Number(p.get("page") ?? 0));
    let items = await indexSummaries();
    if (q)
      items = items.filter((i) =>
        `${i.name} ${i.symbol} ${i.creatorHandle ?? ""} ${i.assets.map((a) => a.symbol).join(" ")}`
          .toLowerCase()
          .includes(q),
      );
    if (type === "ai") items = items.filter((i) => i.creatorIsAgent);
    if (type === "human") items = items.filter((i) => !i.creatorIsAgent);
    if (preIpo) items = items.filter((i) => i.hasPreIpo);
    if (strategy) items = items.filter((i) => i.strategyMode === strategy);
    items.sort(sort);
    return {
      items: items.slice(page * limit, (page + 1) * limit),
      total: items.length,
      benchmark: await benchmarkReturns(),
    };
  });
}
