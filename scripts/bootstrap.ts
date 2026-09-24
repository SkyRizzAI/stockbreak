/**
 * Idempotent bootstrap (PLAN §7.9): market, USDC, mock mints, feeds, fixture
 * prices, index_vault config, SOL for admin/keeper/agent. Writes
 * packages/config/deployments/{cluster}.json.
 *
 *   bun scripts/bootstrap.ts [--cluster localnet|devnet]
 */
import { type Deployment, INDEX_VAULT_PROGRAM_ID, MOCK_MARKET_PROGRAM_ID } from "@repo/config";
import { readDeployment, writeDeployment } from "@repo/config/node";
import { bootstrapMarket } from "@repo/sdk";
import { accountExists, type ChainCtx, chainCtx } from "./lib/chain";
import { log } from "./lib/proc";

const S = "bootstrap";

export async function bootstrap(c: ChainCtx): Promise<Deployment> {
  const r = await bootstrapMarket(c, c.admin, {
    fund: [c.keeper.address, c.agent.address],
    log: (m) => log(S, m),
  });
  const prev = readDeployment(c.cluster);
  // Keep IPO-created mints/feeds only if they still exist (a fresh localnet drops them).
  const mints: Record<string, string> = {};
  const feeds: Record<string, string> = {};
  const ipos: Deployment["ipos"] = {};
  for (const [pre, ev] of Object.entries(prev?.ipos ?? {})) {
    if (!(await accountExists(c, ev.newMint))) continue;
    ipos[pre] = ev;
    mints[ev.newSymbol] = ev.newMint;
    const feed = prev?.feeds[ev.newSymbol];
    if (feed) feeds[ev.newSymbol] = feed;
  }
  const d: Deployment = {
    cluster: c.cluster,
    indexVaultProgram: INDEX_VAULT_PROGRAM_ID,
    mockMarketProgram: MOCK_MARKET_PROGRAM_ID,
    market: r.market,
    config: r.config,
    admin: c.admin.address,
    keeper: c.keeper.address,
    agent: c.agent.address,
    platformTreasury: c.admin.address,
    mints: { ...mints, ...r.mints },
    feeds: { ...feeds, ...r.feeds },
    ipos,
    updatedAt: new Date().toISOString(),
  };
  writeDeployment(d);
  log(S, `deployment written (${Object.keys(d.mints).length} mints)`);
  return d;
}

if (import.meta.main) {
  await bootstrap(await chainCtx());
  process.exit(0);
}
