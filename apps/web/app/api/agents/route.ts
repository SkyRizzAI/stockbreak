import { agents } from "@repo/db";
import { db } from "@/lib/server/ctx";
import { indexSummaries } from "@/lib/server/data";
import { guard } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return guard(async () => {
    const list = await agents(db());
    const sums = await indexSummaries();
    const rows = await db().query.indexes.findMany();
    return list.map((u) => ({
      wallet: u.wallet,
      handle: u.handle,
      agentName: u.agentName,
      created: sums.filter((s) => s.creator === u.wallet),
      managed: sums.filter((s) =>
        rows.some((r) => r.pubkey === s.pubkey && (r.managers as string[]).includes(u.wallet)),
      ),
    }));
  });
}
