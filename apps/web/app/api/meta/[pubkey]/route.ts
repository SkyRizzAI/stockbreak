import { db, serverEnv } from "@/lib/server/ctx";
import { fail, guard, isAddress, ok } from "@/lib/server/http";
import { ensureIndexRow } from "@/lib/server/index-row";

export const dynamic = "force-dynamic";

/** Target of the on-chain `uri`: token-metadata-style JSON. */
export async function GET(_req: Request, ctx: RouteContext<"/api/meta/[pubkey]">) {
  const { pubkey } = await ctx.params;
  return guard(async () => {
    // Address first (synced from chain if the worker lags); symbol URIs from older indexes.
    const row =
      (isAddress(pubkey) ? await ensureIndexRow(pubkey).catch(() => undefined) : undefined) ??
      (await db().query.indexes.findFirst({ where: (t, { eq }) => eq(t.symbol, pubkey) }));
    if (!row) return fail(404, "Index not found");
    const web = serverEnv().WEB_URL;
    return ok({
      name: row.name,
      symbol: row.symbol,
      description: row.description ?? `${row.name} — simulated tokenized stock index.`,
      image: `${web}/i/${row.pubkey}/opengraph-image`,
      external_url: `${web}/i/${row.pubkey}`,
      attributes: [
        { trait_type: "network", value: serverEnv().CLUSTER },
        { trait_type: "simulated", value: "true" },
      ],
    });
  });
}
