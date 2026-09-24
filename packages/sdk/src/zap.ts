/**
 * Zap (PLAN §6.6): join with USDC (swap USDC → each asset, then join) and
 * redeem to USDC (redeem, then swap each asset → USDC). Client-side only.
 */
import type { Address, Instruction, Signature, TransactionSigner } from "@solana/kit";
import {
  fetchFeeds,
  fetchIndex,
  fetchMints,
  fetchTokenBalances,
  type IndexState,
  type Valuation,
  valueIndex,
} from "./accounts";
import { loadAlt } from "./alt";
import { parseFailure, UserFacingError } from "./errors";
import * as market from "./generated/mock-market";
import { createAtaIx, joinIxs, redeemIxs, swapIx } from "./instructions";
import * as math from "./math";
import { pack } from "./pack";
import { ata, feedPda, marketPda, TOKEN_PROGRAM } from "./pda";
import { chainClock, type SolanaCtx } from "./rpc";
import { sendTx } from "./tx";

export const LOCKED_SHARES = 1_000n;

export interface ZapLeg {
  mint: Address;
  tokenProgram: Address;
  decimals: number;
  usdcIn: bigint;
  expectedOut: bigint;
}

export interface ZapInPlan {
  initial: boolean;
  usdcTotal: bigint;
  legs: ZapLeg[];
  expectedShares: bigint;
  valuation: Valuation;
}

async function spread(ctx: SolanaCtx): Promise<number> {
  return (await market.fetchMarket(ctx.rpc, await marketPda())).data.spreadBps;
}

/**
 * Refuse to start a multi-transaction zap when an oracle is (almost) stale, so
 * the user is never left halfway (e.g. redeemed but not swapped back to USDC).
 */
export async function assertFreshPrices(
  ctx: SolanaCtx,
  mints: Address[],
  marginSecs = 10,
): Promise<void> {
  const maxAge = (await market.fetchMarket(ctx.rpc, await marketPda())).data.oracleMaxAgeSecs;
  const feeds = await Promise.all(mints.map((m) => feedPda(m)));
  const [now, got] = await Promise.all([chainClock(ctx), fetchFeeds(ctx, feeds)]);
  for (const f of feeds) {
    const info = got.get(f);
    if (!info || now - info.publishTime > BigInt(Math.max(0, maxAge - marginSecs)))
      throw new UserFacingError(ERRORS_STALE);
  }
}

/**
 * Run `attempt` (build + send one transaction) again while it fails only because
 * an oracle is stale — e.g. right after a warp, before the feeder's next tick.
 * `attempt` rebuilds its instructions each time so min-out uses fresh prices.
 */
async function retryOnStale<T>(attempt: () => Promise<T>, tries = 20, waitMs = 3_000): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (e) {
      if (i >= tries || parseFailure(e)?.name !== "OracleStale") throw e;
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

const ERRORS_STALE = "Prices are updating. Wait a few seconds and retry — nothing was sent.";

async function usdcPrice(ctx: SolanaCtx, usdcMint: Address): Promise<math.Price> {
  const f = await market.fetchOracleFeed(ctx.rpc, await feedPda(usdcMint));
  return { price: f.data.price, expo: f.data.expo };
}

/** Split `usdc` across assets by current value share (or target weights for the first deposit). */
export async function planZapIn(
  ctx: SolanaCtx,
  state: IndexState,
  usdcMint: Address,
  usdc: bigint,
  bufferBps = 100,
): Promise<ZapInPlan> {
  const val = await valueIndex(ctx, state);
  const initial = val.effectiveSupply === 0n;
  const sp = await spread(ctx);
  const up = await usdcPrice(ctx, usdcMint);
  const budget = (usdc * BigInt(10_000 - bufferBps)) / 10_000n;
  const legs: ZapLeg[] = val.assets.map((a) => {
    const share = initial || val.nav === 0n ? BigInt(a.targetBps) : (a.value * 10_000n) / val.nav;
    const usdcIn = (budget * share) / 10_000n;
    const isUsdc = a.entry.mint === usdcMint;
    const expectedOut = isUsdc
      ? usdcIn
      : (math.swapOut(
          usdcIn,
          6,
          math.MULT_FP,
          up,
          a.entry.decimals,
          a.mint.multFp,
          { price: a.feed.price, expo: a.feed.expo },
          sp,
        ) ?? 0n);
    return {
      mint: a.entry.mint,
      tokenProgram: a.entry.tokenProgram,
      decimals: a.entry.decimals,
      usdcIn,
      expectedOut,
    };
  });
  let expectedShares = 0n;
  if (initial) {
    const v = val.assets.reduce(
      (s, a, i) =>
        s +
        (math.valueUsd(legs[i]?.expectedOut ?? 0n, a.entry.decimals, a.mint.multFp, {
          price: a.feed.price,
          expo: a.feed.expo,
        }) ?? 0n),
      0n,
    );
    expectedShares = v > LOCKED_SHARES ? v - LOCKED_SHARES : 0n;
  } else {
    const r = math.joinProportional(
      legs.map((l) => l.expectedOut),
      state.assets.map((a) => a.balance),
      val.effectiveSupply,
    );
    expectedShares = r?.sharesTotal ?? 0n;
  }
  expectedShares -= math.bpsOf(expectedShares, state.fees.entryFeeBps) ?? 0n;
  return { initial, usdcTotal: usdc, legs, expectedShares, valuation: val };
}

export interface ZapProgress {
  step: string;
  done: number;
  total: number;
  signature?: Signature;
}

export interface ZapResult {
  signatures: Signature[];
  shares: bigint;
}

/**
 * Execute a zap in: swap transactions (packed), then join with the actual
 * received amounts. Works with any TransactionSigner (browser wallet, keypair).
 */
export async function zapIn(
  ctx: SolanaCtx,
  user: TransactionSigner,
  index: Address,
  usdcMint: Address,
  usdc: bigint,
  opts: {
    slippageBps?: number;
    lookupTable?: Address | null;
    onProgress?: (p: ZapProgress) => void;
  } = {},
): Promise<ZapResult> {
  const slip = BigInt(opts.slippageBps ?? 100);
  const state = await fetchIndex(ctx, index);
  const plan = await planZapIn(ctx, state, usdcMint, usdc);
  const legs = plan.legs.filter((l) => l.mint !== usdcMint && l.usdcIn > 0n);
  await assertFreshPrices(ctx, [usdcMint, ...state.assets.map((a) => a.mint)]);
  const holdings = await Promise.all(
    plan.legs.map((l) => ata(user.address, l.mint, l.tokenProgram)),
  );
  const before = await fetchTokenBalances(ctx, holdings);

  const groups: Instruction[][] = [];
  for (const l of legs) {
    groups.push([
      await createAtaIx(user, user.address, l.mint, l.tokenProgram),
      await swapIx(
        user,
        { mint: usdcMint, tokenProgram: TOKEN_PROGRAM },
        { mint: l.mint, tokenProgram: l.tokenProgram },
        l.usdcIn,
        (l.expectedOut * (10_000n - slip)) / 10_000n,
      ),
    ]);
  }
  const batches = pack(user.address, groups);
  const total = batches.length + 1;
  const signatures: Signature[] = [];
  for (const [i, b] of batches.entries()) {
    opts.onProgress?.({ step: "swap", done: i, total });
    const sig = await retryOnStale(() => sendTx(ctx, user, b));
    signatures.push(sig);
    opts.onProgress?.({ step: "swap", done: i + 1, total, signature: sig });
  }

  const after = await fetchTokenBalances(ctx, holdings);
  const maxAmounts = plan.legs.map((l, i) => {
    const h = holdings[i] as Address;
    if (l.mint === usdcMint) return l.usdcIn;
    return (after.get(h) ?? 0n) - (before.get(h) ?? 0n);
  });
  const fresh = await fetchIndex(ctx, index);
  const minShares = (plan.expectedShares * (10_000n - slip * 2n)) / 10_000n;
  const ixs = await joinIxs(
    user,
    index,
    fresh,
    maxAmounts,
    minShares > 0n ? minShares : 1n,
    plan.initial,
  );
  opts.onProgress?.({ step: "join", done: batches.length, total });
  const alt = await loadAlt(ctx, opts.lookupTable);
  const sig = await sendTx(ctx, user, ixs, {
    lookupTables: alt ? [opts.lookupTable as Address] : undefined,
  });
  signatures.push(sig);
  opts.onProgress?.({ step: "join", done: total, total, signature: sig });
  const shares =
    (await fetchTokenBalances(ctx, [await ata(user.address, fresh.shareMint, TOKEN_PROGRAM)]))
      .values()
      .next().value ?? 0n;
  return { signatures, shares };
}

export interface ZapOutPlan {
  amounts: bigint[];
  expectedUsdc: bigint;
}

export async function planZapOut(
  ctx: SolanaCtx,
  state: IndexState,
  usdcMint: Address,
  shares: bigint,
): Promise<ZapOutPlan> {
  const val = await valueIndex(ctx, state);
  const fee = math.bpsOf(shares, state.fees.exitFeeBps) ?? 0n;
  const net = shares - fee;
  const amounts = state.assets.map(
    (a) => math.redeemAmount(net, a.balance, val.effectiveSupply) ?? 0n,
  );
  const sp = await spread(ctx);
  const up = await usdcPrice(ctx, usdcMint);
  let expectedUsdc = 0n;
  val.assets.forEach((a, i) => {
    const amt = amounts[i] ?? 0n;
    expectedUsdc +=
      a.entry.mint === usdcMint
        ? amt
        : (math.swapOut(
            amt,
            a.entry.decimals,
            a.mint.multFp,
            { price: a.feed.price, expo: a.feed.expo },
            6,
            math.MULT_FP,
            up,
            sp,
          ) ?? 0n);
  });
  return { amounts, expectedUsdc };
}

/** Redeem `shares` then (optionally) swap every received asset back to USDC. */
export async function zapOut(
  ctx: SolanaCtx,
  user: TransactionSigner,
  index: Address,
  usdcMint: Address,
  shares: bigint,
  opts: {
    toUsdc?: boolean;
    slippageBps?: number;
    lookupTable?: Address | null;
    onProgress?: (p: ZapProgress) => void;
  } = {},
): Promise<ZapResult> {
  const slip = BigInt(opts.slippageBps ?? 100);
  const state = await fetchIndex(ctx, index);
  const plan = await planZapOut(ctx, state, usdcMint, shares);
  const holdings = await Promise.all(
    state.assets.map((a) => ata(user.address, a.mint, a.tokenProgram)),
  );
  const before = await fetchTokenBalances(ctx, holdings);
  const { atas, redeem } = await redeemIxs(
    user,
    index,
    state,
    shares,
    plan.amounts.map((a) => (a * (10_000n - slip)) / 10_000n),
  );
  const signatures: Signature[] = [];
  const alt = await loadAlt(ctx, opts.lookupTable);
  const lookupTables = alt ? [opts.lookupTable as Address] : undefined;
  const pre = pack(
    user.address,
    atas.map((a) => [a]),
  );
  const swapsNeeded = opts.toUsdc !== false;
  if (swapsNeeded) await assertFreshPrices(ctx, [usdcMint, ...state.assets.map((a) => a.mint)]);
  const total = pre.length + 1 + (swapsNeeded ? 1 : 0);
  let done = 0;
  for (const b of pre) {
    signatures.push(await sendTx(ctx, user, b));
    opts.onProgress?.({ step: "prepare", done: ++done, total });
  }
  signatures.push(await sendTx(ctx, user, [redeem], { lookupTables }));
  opts.onProgress?.({ step: "redeem", done: ++done, total, signature: signatures.at(-1) });
  if (!swapsNeeded) return { signatures, shares: 0n };

  const mints = await fetchMints(
    ctx,
    state.assets.map((a) => a.mint),
  );
  const sp = await spread(ctx);
  // Each attempt re-reads balances: assets already swapped back (balance == before)
  // are skipped, so a retry after a stale-oracle failure never sells twice.
  const swapBack = async () => {
    const current = await fetchTokenBalances(ctx, holdings);
    const usdcNow = await usdcPrice(ctx, usdcMint);
    const groups: Instruction[][] = [];
    for (const [i, a] of state.assets.entries()) {
      if (a.mint === usdcMint) continue;
      const h = holdings[i] as Address;
      const got = (current.get(h) ?? 0n) - (before.get(h) ?? 0n);
      if (got <= 0n) continue;
      const feed = await market.fetchOracleFeed(ctx.rpc, a.oracle);
      const exp =
        math.swapOut(
          got,
          a.decimals,
          mints.get(a.mint)?.multFp ?? math.MULT_FP,
          { price: feed.data.price, expo: feed.data.expo },
          6,
          math.MULT_FP,
          usdcNow,
          sp,
        ) ?? 0n;
      groups.push([
        await swapIx(
          user,
          { mint: a.mint, tokenProgram: a.tokenProgram },
          { mint: usdcMint, tokenProgram: TOKEN_PROGRAM },
          got,
          (exp * (10_000n - slip)) / 10_000n,
        ),
      ]);
    }
    for (const b of pack(user.address, groups)) {
      signatures.push(await sendTx(ctx, user, b));
    }
  };
  await retryOnStale(swapBack);
  opts.onProgress?.({ step: "swap", done: total, total, signature: signatures.at(-1) });
  return { signatures, shares: 0n };
}
