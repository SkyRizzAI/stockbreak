import type { NextRequest } from "next/server";
import { benchmarkReturns, creatorsBoard, indexSummaries } from "@/lib/server/data";
import { guard } from "@/lib/server/http";
import type { IndexSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

const KEY: Record<string, keyof IndexSummary> = {
  "24h": "ret24h",
  "7d": "ret7d",
  "30d": "ret30d",
  all: "retAll",
};

export function GET(req: NextRequest) {
  return guard(async () => {
    const p = req.nextUrl.searchParams;
    const board = p.get("board") ?? "indexes";
    const range = p.get("range") ?? "7d";
    const type = p.get("type") ?? "all";
    if (board === "creators") {
      let rows = await creatorsBoard();
      if (type === "ai") rows = rows.filter((r) => r.isAgent);
      if (type === "human") rows = rows.filter((r) => !r.isAgent);
      return { board, rows };
    }
    const key = KEY[range] ?? "ret7d";
    let rows = await indexSummaries();
    if (type === "ai") rows = rows.filter((r) => r.creatorIsAgent);
    if (type === "human") rows = rows.filter((r) => !r.creatorIsAgent);
    rows.sort((a, b) => ((b[key] as number | null) ?? -1e9) - ((a[key] as number | null) ?? -1e9));
    const bench = await benchmarkReturns();
    const benchKey = key as "ret24h" | "ret7d" | "ret30d" | "retAll";
    return { board, range, rows, benchmark: bench[benchKey] ?? null };
  });
}
