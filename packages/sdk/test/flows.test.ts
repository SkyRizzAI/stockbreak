/** SDK end-to-end against an isolated Surfpool (A12, P6 gate). */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Address, KeyPairSigner, Signature } from "@solana/kit";
import { fetchIndex, fetchTokenBalances, valueIndex } from "../src/accounts";
import { humanizeError, parseFailure } from "../src/errors";
import { decodeVaultEvents } from "../src/events";
import { createIndexFlow, nextIndexId } from "../src/flows";
import * as vault from "../src/generated/index-vault";
import {
  applyUpdateIx,
  claimFeesIxs,
  faucetIxs,
  proposeUpdateIx,
  syncTargetsIx,
} from "../src/instructions";
import { migrateAllHolders, registerIpoEvent } from "../src/ipo";
import { ata, TOKEN_PROGRAM } from "../src/pda";
import { planRebalance, rebalanceIxs } from "../src/rebalance";
import { sendTx } from "../src/tx";
import { zapIn, zapOut } from "../src/zap";
import { stopTestValidator, type TestEnv, testEnv } from "./localnet";

const T = { timeout: 180_000 };
let env: TestEnv;
let creator: KeyPairSigner;
let indexA: Address;

const strategy = (): vault.StrategyArgs => ({
  mode: vault.StrategyMode.Threshold,
  driftThresholdBps: 500,
  periodSecs: 0,
  maxSlippageBps: 100,
  cooldownSecs: 0,
  allowKeeper: true,
});

async function logsOf(sig: Signature): Promise<readonly string[]> {
  for (let i = 0; i < 20; i++) {
    const tx = await env.ctx.rpc
      .getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
        encoding: "json",
      })
      .send();
    if (tx?.meta?.logMessages) return tx.meta.logMessages;
    await Bun.sleep(250);
  }
  return [];
}

afterAll(() => stopTestValidator());

beforeAll(async () => {
  env = await testEnv();
  creator = await env.newUser(300_000_000_000n);
}, 300_000);

describe("sdk flows", () => {
  test(
    "create index (4 assets, no ALT) + zap in $100k",
    async () => {
      await env.refreshPrices();
      const r = await createIndexFlow(env.ctx, {
        creator,
        indexId: await nextIndexId(env.ctx, creator.address),
        name: "Mag Four",
        symbol: "MAG4",
        uri: "http://localhost:3000/api/meta/x",
        assets: [
          { mint: env.mint("AAPLx"), weightBps: 4000 },
          { mint: env.mint("NVDAx"), weightBps: 3000 },
          { mint: env.mint("TSLAx"), weightBps: 2000 },
          { mint: env.mint("SPACEX-pre"), weightBps: 1000 },
        ],
        fees: { mgmtFeeBps: 500, entryFeeBps: 0, exitFeeBps: 0 },
        strategy: strategy(),
      });
      indexA = r.index;
      expect(r.lookupTable).toBeNull();
      const z = await zapIn(env.ctx, creator, indexA, env.usdc, 100_000_000_000n);
      expect(z.shares).toBeGreaterThan(98_000_000_000n);
      const st = await fetchIndex(env.ctx, indexA);
      const v = await valueIndex(env.ctx, st);
      expect(v.nav).toBeGreaterThan(98_000_000_000n);
      expect(v.driftMax).toBeLessThanOrEqual(200);
      // ~$1 per share
      expect(v.sharePrice).toBeGreaterThan(990_000n);
      expect(v.sharePrice).toBeLessThan(1_010_000n);
      const events = decodeVaultEvents(await logsOf(z.signatures.at(-1) as Signature));
      expect(events.map((e) => e.name)).toContain("Joined");
    },
    T,
  );

  let userB: KeyPairSigner;
  test(
    "user B zaps in $1,000 (proportional)",
    async () => {
      userB = await env.newUser(2_000_000_000n);
      const z = await zapIn(env.ctx, userB, indexA, env.usdc, 1_000_000_000n);
      expect(z.shares).toBeGreaterThan(960_000_000n);
      expect(z.shares).toBeLessThan(1_000_000_000n);
    },
    T,
  );

  test(
    "keeper rebalance after +30% price shock",
    async () => {
      await env.refreshPrices({ AAPLx: (env.prices.AAPLx ?? 337) * 1.3 });
      const keeper = await env.newUser();
      const st = await fetchIndex(env.ctx, indexA);
      const val = await valueIndex(env.ctx, st);
      const plan = planRebalance(st, val, {
        keeper: true,
        now: BigInt(Math.floor(Date.now() / 1000)),
        spreadBps: 30,
      });
      expect(plan?.triggered).toBe(true);
      if (!plan) return;
      expect(plan.driftAfter).toBeLessThan(plan.driftBefore);
      const sig = await sendTx(env.ctx, keeper, await rebalanceIxs(keeper, indexA, st, plan), {
        computeUnitLimit: 600_000,
      });
      const events = decodeVaultEvents(await logsOf(sig));
      const ev = events.find((e) => e.name === "RebalanceExecuted");
      expect(ev).toBeDefined();
      const after = await valueIndex(env.ctx, await fetchIndex(env.ctx, indexA));
      expect(after.driftSum).toBeLessThan(val.driftSum);
    },
    T,
  );

  let child: Address;
  test(
    "follow: child syncs after parent update",
    async () => {
      const c = await env.newUser(50_000_000_000n);
      const r = await createIndexFlow(env.ctx, {
        creator: c,
        indexId: await nextIndexId(env.ctx, c.address),
        name: "Mag Follow",
        symbol: "MAGF",
        uri: "",
        assets: [
          { mint: env.mint("AAPLx"), weightBps: 4000 },
          { mint: env.mint("NVDAx"), weightBps: 3000 },
          { mint: env.mint("TSLAx"), weightBps: 2000 },
          { mint: env.mint("SPACEX-pre"), weightBps: 1000 },
        ],
        fees: { mgmtFeeBps: 100, entryFeeBps: 0, exitFeeBps: 0 },
        strategy: strategy(),
        parent: indexA,
        followsParent: true,
      });
      child = r.index;
      await zapIn(env.ctx, c, child, env.usdc, 10_000_000_000n);
      const st = await fetchIndex(env.ctx, indexA);
      await sendTx(env.ctx, creator, [
        await proposeUpdateIx(creator, indexA, st, {
          assets: [
            { mint: env.mint("AAPLx"), weightBps: 3000 },
            { mint: env.mint("NVDAx"), weightBps: 4000 },
            { mint: env.mint("TSLAx"), weightBps: 2000 },
            { mint: env.mint("SPACEX-pre"), weightBps: 1000 },
          ],
        }),
      ]);
      await sendTx(env.ctx, creator, [
        await applyUpdateIx(creator, indexA, await fetchIndex(env.ctx, indexA)),
      ]);
      const p = await fetchIndex(env.ctx, indexA);
      const cs = await fetchIndex(env.ctx, child);
      await sendTx(env.ctx, c, [await syncTargetsIx(c, child, cs, indexA, p)]);
      const synced = await fetchIndex(env.ctx, child);
      expect(synced.assets.map((a) => a.targetWeightBps)).toEqual([3000, 4000, 2000, 1000]);
    },
    T,
  );

  test(
    "IPO: register + migrate all holders",
    async () => {
      await env.refreshPrices();
      const ev = await registerIpoEvent(env.ctx, env.admin, "SPACEX-pre");
      const res = await migrateAllHolders(env.ctx, env.admin, ev);
      expect(res.migrated.map((m) => m.index)).toContain(indexA);
      expect(res.migrated.map((m) => m.index)).toContain(child);
      const st = await fetchIndex(env.ctx, indexA);
      expect(st.assets[3]?.mint).toBe(ev.newMint);
      expect(st.assets[3]?.kind).toBe(vault.AssetKind.Stock);
    },
    T,
  );

  test(
    "claim creator fees",
    async () => {
      await Bun.sleep(1500);
      const st = await fetchIndex(env.ctx, indexA);
      await sendTx(
        env.ctx,
        creator,
        await claimFeesIxs(creator, indexA, st, vault.FeeKind.Creator),
      );
      const bal = await fetchTokenBalances(env.ctx, [
        await ata(creator.address, st.shareMint, TOKEN_PROGRAM),
      ]);
      expect([...bal.values()][0]).toBeGreaterThan(0n);
    },
    T,
  );

  test(
    "6-asset index uses a lookup table for create and join",
    async () => {
      await env.refreshPrices();
      const u = await env.newUser(50_000_000_000n);
      const r = await createIndexFlow(env.ctx, {
        creator: u,
        indexId: await nextIndexId(env.ctx, u.address),
        name: "Big Six",
        symbol: "BIG6",
        uri: "http://localhost:3000/api/meta/big6",
        assets: ["AAPLx", "NVDAx", "TSLAx", "MSFTx", "GOOGLx", "AMZNx"].map((s, i) => ({
          mint: env.mint(s),
          weightBps: i < 4 ? 1700 : 1600,
        })),
        fees: { mgmtFeeBps: 100, entryFeeBps: 0, exitFeeBps: 0 },
        strategy: strategy(),
      });
      expect(r.lookupTable).not.toBeNull();
      const z = await zapIn(env.ctx, u, r.index, env.usdc, 20_000_000_000n, {
        lookupTable: r.lookupTable,
      });
      expect(z.shares).toBeGreaterThan(19_000_000_000n);
    },
    T,
  );

  test(
    "user B zaps out to USDC",
    async () => {
      await env.refreshPrices();
      const st = await fetchIndex(env.ctx, indexA);
      const shareAta = await ata(userB.address, st.shareMint, TOKEN_PROGRAM);
      const shares = [...(await fetchTokenBalances(env.ctx, [shareAta])).values()][0] ?? 0n;
      const usdcAta = await ata(userB.address, env.usdc, TOKEN_PROGRAM);
      const before = [...(await fetchTokenBalances(env.ctx, [usdcAta])).values()][0] ?? 0n;
      await zapOut(env.ctx, userB, indexA, env.usdc, shares);
      const after = [...(await fetchTokenBalances(env.ctx, [usdcAta])).values()][0] ?? 0n;
      expect(after - before).toBeGreaterThan(900_000_000n);
      expect([...(await fetchTokenBalances(env.ctx, [shareAta])).values()][0]).toBe(0n);
    },
    T,
  );

  test(
    "program errors map to human messages",
    async () => {
      const u = await env.newUser();
      let err: unknown;
      try {
        await sendTx(env.ctx, u, await faucetIxs(u, env.usdc, 2_000_000_000_000n));
      } catch (e) {
        err = e;
      }
      expect(parseFailure(err)?.name).toBe("FaucetLimitExceeded");
      expect(humanizeError(err)).toBe("Faucet limit exceeded for one request.");
    },
    T,
  );
});
