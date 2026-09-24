import { ASSETS, CLUSTER_PARAMS } from "@repo/config";
import { deployment, serverEnv } from "@/lib/server/ctx";
import { guard } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Deployment addresses + asset registry for the client. */
export function GET() {
  return guard(async () => {
    const d = deployment();
    const e = serverEnv();
    return {
      cluster: e.CLUSTER,
      ready: !!d,
      market: d?.market ?? null,
      config: d?.config ?? null,
      platformTreasury: d?.platformTreasury ?? null,
      params: {
        ...CLUSTER_PARAMS[e.CLUSTER],
        faucetMaxUsdc: CLUSTER_PARAMS[e.CLUSTER].faucetMaxUsdc.toString(),
      },
      faucetSolPerRequest: e.FAUCET_SOL_PER_REQUEST,
      assets: ASSETS.filter((a) => d?.mints[a.symbol]).map((a) => ({
        symbol: a.symbol,
        name: a.name,
        kind: a.kind,
        decimals: a.decimals,
        token2022: a.token2022,
        mint: d?.mints[a.symbol] ?? "",
        feed: d?.feeds[a.symbol] ?? "",
        benchmark: !!a.benchmark,
        ipoTarget: a.ipoTarget ?? null,
        listed: !d?.ipos[a.symbol],
      })),
      ipos: d?.ipos ?? {},
    };
  });
}
