/** Snapshot, keeper, fee accrual and follow-sync loops (PLAN §7.4). */
import { BENCHMARK_INDEX, getIndex, insertSnapshot, setLookupTable } from "@repo/db";
import {
  accrueFeesIx,
  createIndexAlt,
  describeError,
  fetchAllIndexes,
  fetchFeeds,
  fits,
  type IndexState,
  loadAlt,
  market,
  marketPda,
  planRebalance,
  priceUsd,
  rebalanceIxs,
  sendTx,
  syncResult,
  syncTargetsIx,
  valueIndex,
} from "@repo/sdk";
import type { Address } from "@solana/kit";
import { chainNow, type WorkerCtx } from "../ctx";

// ---------------- snapshot ----------------

export async function snapshotTick(c: WorkerCtx): Promise<number> {
  const all = await fetchAllIndexes(c);
  const ts = new Date(Math.floor(Date.now() / 1000) * 1000);
  let n = 0;
  for (const { address, data } of all) {
    const v = await valueIndex(c, data);
    if (v.effectiveSupply === 0n) continue;
    await insertSnapshot(c.db, {
      index: address,
      ts,
      navMicroUsd: v.nav,
      supply: v.effectiveSupply,
      sharePriceMicroUsd: v.sharePrice,
      weights: v.assets.map((a) => ({
        mint: a.entry.mint,
        symbol: c.symbolOf(a.entry.mint),
        weightBps: a.weightBps,
        targetBps: a.targetBps,
      })),
      synthetic: false,
    });
    n++;
  }
  const d = c.deployment();
  const spy = d.feeds.SPYx;
  if (spy) {
    const f = (await fetchFeeds(c, [spy as Address])).get(spy as Address);
    if (f) {
      const p = BigInt(Math.round(priceUsd(f) * 1e6));
      await insertSnapshot(c.db, {
        index: BENCHMARK_INDEX,
        ts,
        navMicroUsd: p,
        supply: 1_000_000n,
        sharePriceMicroUsd: p,
        weights: [],
        synthetic: false,
      });
    }
  }
  return n;
}

// ---------------- keeper ----------------

const keeperBackoff = new Map<string, number>();

export async function keeperTick(c: WorkerCtx): Promise<number> {
  const all = await fetchAllIndexes(c);
  const spread = (await market.fetchMarket(c.rpc, await marketPda())).data.spreadBps;
  const now = await chainNow(c);
  let done = 0;
  for (const { address, data } of all) {
    if (!data.strategy.allowKeeper || data.paused) continue;
    if ((keeperBackoff.get(address) ?? 0) > Date.now()) continue;
    const v = await valueIndex(c, data);
    if (v.effectiveSupply === 0n) continue;
    const plan = planRebalance(data, v, { keeper: true, now, spreadBps: spread });
    if (!plan?.triggered) continue;
    try {
      const ixs = await rebalanceIxs(c.keeper, address as Address, data, plan);
      let lookupTables: Address[] | undefined;
      if (!fits(c.keeper.address, ixs)) {
        const row = await getIndex(c.db, address);
        let alt = row?.lookupTable as Address | null | undefined;
        if (!alt || !(await loadAlt(c, alt))) {
          alt = await createIndexAlt(c, c.keeper, address as Address, data.shareMint, data.assets);
          await setLookupTable(c.db, address, alt);
          c.log("keeper", `created lookup table ${alt} for ${data.symbol}`);
        }
        lookupTables = [alt];
      }
      const sig = await sendTx(c, c.keeper, ixs, { lookupTables, computeUnitLimit: 800_000 });
      c.log(
        "keeper",
        `rebalanced ${data.symbol}: drift ${plan.driftBefore}→${plan.driftAfter} bps (${plan.reason}) ${sig}`,
      );
      done++;
    } catch (e) {
      keeperBackoff.set(address, Date.now() + 60_000);
      c.log("keeper", `rebalance ${data.symbol} failed: ${describeError(e)}`);
    }
  }
  return done;
}

// ---------------- fees ----------------

export async function feesTick(c: WorkerCtx): Promise<number> {
  const all = await fetchAllIndexes(c);
  const now = await chainNow(c);
  let n = 0;
  for (const { address, data } of all) {
    if (now - data.lastFeeTs < BigInt(c.env.FEES_INTERVAL)) continue;
    if (data.rebalanceTicket.__option === "Some") continue;
    try {
      await sendTx(c, c.keeper, [await accrueFeesIx(address as Address, data)]);
      n++;
    } catch (e) {
      c.log("fees", `accrue ${data.symbol} failed: ${describeError(e)}`);
    }
  }
  return n;
}

// ---------------- follow ----------------

function targetKey(assets: { mint: string; targetWeightBps: number }[]): string {
  return assets.map((a) => `${a.mint}:${a.targetWeightBps}`).join("|");
}

export async function followTick(c: WorkerCtx): Promise<number> {
  const all = await fetchAllIndexes(c);
  const byAddr = new Map<string, IndexState>(all.map((x) => [x.address, x.data]));
  let n = 0;
  for (const { address, data } of all) {
    if (!data.followsParent || data.parent.__option !== "Some") continue;
    const parent = byAddr.get(data.parent.value);
    if (!parent) continue;
    const want = syncResult(data, parent);
    if (targetKey(want) === targetKey(data.assets)) continue;
    try {
      const sig = await sendTx(c, c.keeper, [
        await syncTargetsIx(c.keeper, address as Address, data, data.parent.value, parent),
      ]);
      c.log("follow", `synced ${data.symbol} to parent ${parent.symbol} ${sig}`);
      n++;
    } catch (e) {
      c.log("follow", `sync ${data.symbol} failed: ${describeError(e)}`);
    }
  }
  return n;
}
