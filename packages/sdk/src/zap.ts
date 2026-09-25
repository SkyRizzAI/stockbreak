/**
 * Zap (PLAN §6.6): join with USDC (swap USDC → each asset, then join) and
 * redeem to USDC (redeem, then swap each asset → USDC). Client-side only.
 *
 * Both flows span several transactions. When a later transaction fails after
 * earlier ones landed, a `PartialZapError` says what the wallet now holds and
 * how to recover (`joinWithHeld`, `swapToUsdc`).
 */
import {
  type Address,
  type AddressesByLookupTableAddress,
  fetchEncodedAccounts,
  type Instruction,
  type Signature,
  type TransactionSigner,
} from "@solana/kit";
import {
  fetchFeeds,
  fetchIndex,
  fetchMints,
  fetchTokenBalances,
  type IndexState,
  type MintInfo,
  type Valuation,
  valueIndex,
} from "./accounts";
import { loadAlt } from "./alt";
import {
  humanizeError,
  isWalletGone,
  PartialZapError,
  parseFailure,
  UserFacingError,
  type ZapRecovery,
} from "./errors";
import * as market from "./generated/mock-market";
import { createAtaIx, joinIxs, redeemIxs, swapIx } from "./instructions";
import * as math from "./math";
import { fits, pack } from "./pack";
import { ata, feedPda, marketPda, TOKEN_PROGRAM } from "./pda";
import { chainClock, type SolanaCtx } from "./rpc";
import { sendTx } from "./tx";

export const LOCKED_SHARES = 1_000n;
/** Program constant `MIN_INITIAL_VALUE` (micro-USD): the first deposit's minimum value. */
export const MIN_INITIAL_VALUE = 1_000_000n;
/**
 * Smallest first deposit (micro-USDC) the app accepts: $1 plus the 1% budget
 * buffer, the swap spread and room for prices to move between plan and join.
 */
export const MIN_INITIAL_USDC = 1_100_000n;
/** Fixed-point scale for the USDC split (finer than bps so tiny weights still get a leg). */
const SPLIT_FP = 1_000_000_000n;
/** Rent of one token account (Token-2022 accounts with extensions are a bit larger). */
export const ATA_RENT_LAMPORTS = 2_100_000n;

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
  /** Value (micro-USD) of the assets the swaps should deliver. */
  expectedValue: bigint;
  valuation: Valuation;
}

async function spread(ctx: SolanaCtx): Promise<number> {
  return (await market.fetchMarket(ctx.rpc, await marketPda())).data.spreadBps;
}

const ERRORS_STALE = "Prices are updating. Wait a few seconds and retry — nothing was sent.";

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
 * Like assertFreshPrices, but waits for the price feeder (right after a warp or a feeder
 * hiccup the oracle catches up within one or two ticks) before giving up.
 */
export async function waitForFreshPrices(
  ctx: SolanaCtx,
  mints: Address[],
  onWait?: () => void,
  timeoutMs = 45_000,
): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (let first = true; ; first = false) {
    try {
      await assertFreshPrices(ctx, mints);
      return;
    } catch (e) {
      if (!(e instanceof UserFacingError) || Date.now() > until) throw e;
      if (first) onWait?.();
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
}

const hasTicket = (s: IndexState) => s.rebalanceTicket.__option === "Some";

/** Joins are rejected on chain while paused or mid-rebalance: say so before any swap. */
export function assertJoinable(state: IndexState): void {
  if (state.paused)
    throw new UserFacingError("This index is paused. Joining is disabled — nothing was sent.");
  if (hasTicket(state))
    throw new UserFacingError(
      "A rebalance is in progress. Try again in a few seconds — nothing was sent.",
    );
}

/** Redeem works while paused, but not during an active rebalance. */
export function assertRedeemable(state: IndexState): void {
  if (hasTicket(state))
    throw new UserFacingError(
      "A rebalance is in progress. Redeem opens again in a few seconds — nothing was sent.",
    );
}

/**
 * Run `attempt` (build + send one transaction) again while it fails only because
 * an oracle is stale — e.g. right after a warp, before the feeder's next tick.
 * `attempt` rebuilds its instructions each time so min-out uses fresh prices.
 */
async function retryOnStale<T>(
  attempt: () => Promise<T>,
  onWait?: () => void,
  tries = 20,
  waitMs = 3_000,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (e) {
      if (i >= tries || parseFailure(e)?.name !== "OracleStale") throw e;
      onWait?.();
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

async function usdcPrice(ctx: SolanaCtx, usdcMint: Address): Promise<math.Price> {
  const f = await market.fetchOracleFeed(ctx.rpc, await feedPda(usdcMint));
  return { price: f.data.price, expo: f.data.expo };
}

/** Which of `accounts` exist on chain. */
async function existing(ctx: SolanaCtx, accounts: Address[]): Promise<boolean[]> {
  if (!accounts.length) return [];
  const accs = await fetchEncodedAccounts(ctx.rpc, accounts);
  return accs.map((a) => a.exists);
}

/** Greedily pack items (each one a group of instructions) into transactions. */
function packItems<T>(
  payer: Address,
  items: T[],
  ixsOf: (t: T) => Instruction[],
  alt?: AddressesByLookupTableAddress,
): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  for (const it of items) {
    if (cur.length && fits(payer, [...cur, it].flatMap(ixsOf), alt)) {
      cur.push(it);
      continue;
    }
    if (cur.length) out.push(cur);
    cur = [it];
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Smallest USDC amount (micro) whose swap yields at least 1 raw unit of the asset. */
function minUsdcForOneRaw(out: (usdcIn: bigint) => bigint): bigint {
  let v = 1n;
  for (let i = 0; i < 48 && out(v) === 0n; i++) v *= 2n;
  return v;
}

/**
 * First deposit into an empty index: the program requires the deposited values to match
 * the target weights within INITIAL_WEIGHT_TOLERANCE_BPS at the oracle prices of the join.
 * Swaps land at earlier prices, so scale every amount down to the most-constrained leg:
 * the deposit then matches the targets exactly and the small excess stays in the wallet.
 */
export function fitInitialAmounts(val: Valuation, amounts: bigint[]): bigint[] {
  const values = val.assets.map(
    (a, i) =>
      math.valueUsd(amounts[i] ?? 0n, a.entry.decimals, a.mint.multFp, {
        price: a.feed.price,
        expo: a.feed.expo,
      }) ?? 0n,
  );
  // Full-index value the smallest leg can support (value per 100% of weight).
  let k: bigint | null = null;
  for (const [i, a] of val.assets.entries()) {
    if (a.targetBps <= 0) continue;
    const per = ((values[i] ?? 0n) * 10_000n) / BigInt(a.targetBps);
    if (k === null || per < k) k = per;
  }
  if (!k) return amounts.map(() => 0n);
  return val.assets.map((a, i) => {
    const v = values[i] ?? 0n;
    const amt = amounts[i] ?? 0n;
    if (a.targetBps <= 0 || v === 0n) return 0n;
    const want = ((k as bigint) * BigInt(a.targetBps)) / 10_000n;
    return want >= v ? amt : (amt * want) / v;
  });
}

/**
 * Shares minted for depositing `amounts` (one per index asset) — exactly as the
 * program computes them, before fee accrual (which only adds shares).
 */
function sharesFor(
  val: Valuation,
  state: IndexState,
  amounts: bigint[],
): { initial: boolean; value: bigint; shares: bigint } {
  const initial = val.effectiveSupply === 0n;
  let gross = 0n;
  let value = 0n;
  if (initial) {
    value = val.assets.reduce(
      (s, a, i) =>
        s +
        (math.valueUsd(amounts[i] ?? 0n, a.entry.decimals, a.mint.multFp, {
          price: a.feed.price,
          expo: a.feed.expo,
        }) ?? 0n),
      0n,
    );
    gross = value >= MIN_INITIAL_VALUE && value > LOCKED_SHARES ? value - LOCKED_SHARES : 0n;
  } else {
    gross =
      math.joinProportional(
        amounts,
        state.assets.map((a) => a.balance),
        val.effectiveSupply,
      )?.sharesTotal ?? 0n;
  }
  const shares = gross - (math.bpsOf(gross, state.fees.entryFeeBps) ?? 0n);
  return { initial, value, shares };
}

/**
 * Split `usdc` across assets by current value share (or target weights for the
 * first deposit). The split uses 1e9 fixed point, and every asset the vault
 * holds gets at least one raw unit — otherwise the proportional join mints 0.
 */
export async function planZapIn(
  ctx: SolanaCtx,
  state: IndexState,
  usdcMint: Address,
  usdc: bigint,
  bufferBps = 100,
): Promise<ZapInPlan> {
  const val = await valueIndex(ctx, state);
  const initial = val.effectiveSupply === 0n;
  const [sp, up] = await Promise.all([spread(ctx), usdcPrice(ctx, usdcMint)]);
  const budget = (usdc * BigInt(10_000 - bufferBps)) / 10_000n;
  const legs: ZapLeg[] = val.assets.map((a) => {
    const isUsdc = a.entry.mint === usdcMint;
    const out = (usdcIn: bigint) =>
      isUsdc
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
    const shareFp =
      initial || val.nav === 0n
        ? (BigInt(a.targetBps) * SPLIT_FP) / 10_000n
        : (a.value * SPLIT_FP) / val.nav;
    let usdcIn = (budget * shareFp) / SPLIT_FP;
    let expectedOut = out(usdcIn);
    if (!initial && a.entry.balance > 0n && expectedOut === 0n && usdc > 0n) {
      usdcIn = minUsdcForOneRaw(out);
      expectedOut = out(usdcIn);
    }
    return {
      mint: a.entry.mint,
      tokenProgram: a.entry.tokenProgram,
      decimals: a.entry.decimals,
      usdcIn,
      expectedOut,
    };
  });
  const r = sharesFor(
    val,
    state,
    legs.map((l) => l.expectedOut),
  );
  const spent = legs.reduce((s, l) => s + l.usdcIn, 0n);
  return {
    initial,
    usdcTotal: usdc,
    legs,
    // More USDC than entered would be needed (dust legs on a tiny amount): too small.
    expectedShares: spent > usdc ? 0n : r.shares,
    expectedValue: r.value,
    valuation: val,
  };
}

export interface ZapProgress {
  /** "swap" | "join" | "prepare" | "redeem" | "wait" (waiting for fresh prices). */
  step: string;
  done: number;
  total: number;
  signature?: Signature;
}

export interface ZapResult {
  signatures: Signature[];
  shares: bigint;
}

interface SellItem {
  mint: Address;
  tokenProgram: Address;
  decimals: number;
  amount: bigint;
}

/** Asset → USDC swap instructions priced at the latest oracle values; dust is skipped. */
async function sellIxs(
  ctx: SolanaCtx,
  user: TransactionSigner,
  usdcMint: Address,
  items: SellItem[],
  slip: bigint,
  createUsdcAta: boolean,
): Promise<Instruction[]> {
  if (!items.length) return [];
  const [sp, up, mints, feeds] = await Promise.all([
    spread(ctx),
    usdcPrice(ctx, usdcMint),
    fetchMints(
      ctx,
      items.map((i) => i.mint),
    ),
    fetchFeeds(ctx, await Promise.all(items.map((i) => feedPda(i.mint)))),
  ]);
  const ixs: Instruction[] = [];
  if (createUsdcAta) ixs.push(await createAtaIx(user, user.address, usdcMint, TOKEN_PROGRAM));
  for (const it of items) {
    const feed = feeds.get(await feedPda(it.mint));
    if (!feed) continue;
    const exp =
      math.swapOut(
        it.amount,
        it.decimals,
        mints.get(it.mint)?.multFp ?? math.MULT_FP,
        { price: feed.price, expo: feed.expo },
        6,
        math.MULT_FP,
        up,
        sp,
      ) ?? 0n;
    if (exp === 0n) continue;
    ixs.push(
      await swapIx(
        user,
        { mint: it.mint, tokenProgram: it.tokenProgram },
        { mint: usdcMint, tokenProgram: TOKEN_PROGRAM },
        it.amount,
        (exp * (10_000n - slip)) / 10_000n,
      ),
    );
  }
  return ixs;
}

/** Placeholder-priced sell instructions, only used to size transactions. */
async function sizingSellIxs(
  user: TransactionSigner,
  usdcMint: Address,
  it: SellItem,
): Promise<Instruction[]> {
  return [
    await swapIx(
      user,
      { mint: it.mint, tokenProgram: it.tokenProgram },
      { mint: usdcMint, tokenProgram: TOKEN_PROGRAM },
      it.amount,
      1n,
    ),
  ];
}

/**
 * Sell `items` for USDC in as few transactions as fit. Each transaction is
 * rebuilt with fresh prices on every stale-oracle retry.
 */
async function sellAll(
  ctx: SolanaCtx,
  user: TransactionSigner,
  usdcMint: Address,
  items: SellItem[],
  slip: bigint,
  signatures: Signature[],
  onBatch?: (sig: Signature) => void,
  onWait?: () => void,
): Promise<void> {
  if (!items.length) return;
  const [usdcAtaExists] = await existing(ctx, [await ata(user.address, usdcMint, TOKEN_PROGRAM)]);
  const sized = await Promise.all(
    items.map(async (it) => ({ it, ixs: await sizingSellIxs(user, usdcMint, it) })),
  );
  const batches = packItems(user.address, sized, (s) => s.ixs);
  for (const [i, b] of batches.entries()) {
    const sig = await retryOnStale(async () => {
      const ixs = await sellIxs(
        ctx,
        user,
        usdcMint,
        b.map((s) => s.it),
        slip,
        i === 0 && !usdcAtaExists,
      );
      if (!ixs.some((x) => x.programAddress === market.MOCK_MARKET_PROGRAM_ADDRESS)) return null;
      return sendTx(ctx, user, ixs);
    }, onWait);
    if (sig) {
      signatures.push(sig);
      onBatch?.(sig);
    }
  }
}

/** Raw token deltas `after - before` per mint (only positive ones). */
function deltas(
  mints: Address[],
  holdings: Address[],
  before: Map<Address, bigint>,
  after: Map<Address, bigint>,
): { mint: Address; amount: bigint }[] {
  const out: { mint: Address; amount: bigint }[] = [];
  mints.forEach((mint, i) => {
    const h = holdings[i] as Address;
    const d = (after.get(h) ?? 0n) - (before.get(h) ?? 0n);
    if (d > 0n) out.push({ mint, amount: d });
  });
  return out;
}

function partial(
  e: unknown,
  opts: {
    message: string;
    goneSuffix: string;
    stage: PartialZapError["stage"];
    completed: Signature[];
    total: number;
    recovery: ZapRecovery[];
    held: { mint: Address; amount: bigint }[];
  },
): PartialZapError {
  const gone = isWalletGone(e);
  const message = gone
    ? `Wallet disconnected. ${opts.completed.length} of ${opts.total} steps completed. ${opts.goneSuffix}`
    : opts.message;
  return new PartialZapError(
    message,
    opts.stage,
    [...opts.completed],
    opts.total,
    opts.recovery,
    opts.held,
    gone ? "Wallet disconnected." : humanizeError(e),
    { cause: e },
  );
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
  assertJoinable(state);
  const plan = await planZapIn(ctx, state, usdcMint, usdc);
  if (plan.initial && (usdc < MIN_INITIAL_USDC || plan.expectedValue < MIN_INITIAL_VALUE))
    throw new UserFacingError(
      "The first deposit must be worth at least $1 after swap costs. Use $1.10 or more — nothing was sent.",
    );
  if (plan.expectedShares <= 0n)
    throw new UserFacingError("The amount is too small to mint any shares. Nothing was sent.");
  const legs = plan.legs.filter((l) => l.mint !== usdcMint && l.usdcIn > 0n);
  await waitForFreshPrices(ctx, [usdcMint, ...state.assets.map((a) => a.mint)], () =>
    opts.onProgress?.({ step: "wait", done: 0, total: legs.length + 1 }),
  );
  const mints = plan.legs.map((l) => l.mint);
  const holdings = await Promise.all(
    plan.legs.map((l) => ata(user.address, l.mint, l.tokenProgram)),
  );
  const [before, exists] = await Promise.all([
    fetchTokenBalances(ctx, holdings),
    existing(ctx, holdings),
  ]);
  const hasAta = new Map(mints.map((m, i) => [m, exists[i] ?? false]));

  // Build one leg's instructions; min-out comes from `fresh` prices when given.
  const legIxs = async (
    l: ZapLeg,
    fresh?: { up: math.Price; sp: number; feeds: Map<Address, math.Price> },
  ): Promise<Instruction[]> => {
    let minOut = 1n;
    if (fresh) {
      const v = plan.valuation.assets.find((a) => a.entry.mint === l.mint);
      const p = fresh.feeds.get(l.mint);
      const exp =
        v && p
          ? (math.swapOut(
              l.usdcIn,
              6,
              math.MULT_FP,
              fresh.up,
              l.decimals,
              v.mint.multFp,
              p,
              fresh.sp,
            ) ?? 0n)
          : 0n;
      minOut = (exp * (10_000n - slip)) / 10_000n;
    }
    const ixs: Instruction[] = [];
    if (!hasAta.get(l.mint))
      ixs.push(await createAtaIx(user, user.address, l.mint, l.tokenProgram));
    ixs.push(
      await swapIx(
        user,
        { mint: usdcMint, tokenProgram: TOKEN_PROGRAM },
        { mint: l.mint, tokenProgram: l.tokenProgram },
        l.usdcIn,
        minOut,
      ),
    );
    return ixs;
  };
  const sized = await Promise.all(legs.map(async (l) => ({ l, ixs: await legIxs(l) })));
  const batches = packItems(user.address, sized, (s) => s.ixs);
  const total = batches.length + 1;
  const signatures: Signature[] = [];
  const progress = (step: string, done: number, signature?: Signature) =>
    opts.onProgress?.({ step, done, total, signature });

  const heldNow = async () => {
    try {
      return deltas(mints, holdings, before, await fetchTokenBalances(ctx, holdings)).filter(
        (h) => h.mint !== usdcMint,
      );
    } catch {
      return [];
    }
  };

  try {
    for (const [i, b] of batches.entries()) {
      progress("swap", i);
      const sig = await retryOnStale(
        async () => {
          const [sp, up, feeds] = await Promise.all([
            spread(ctx),
            usdcPrice(ctx, usdcMint),
            fetchFeeds(ctx, await Promise.all(b.map((s) => feedPda(s.l.mint)))),
          ]);
          const prices = new Map<Address, math.Price>();
          for (const f of feeds.values()) prices.set(f.mint, { price: f.price, expo: f.expo });
          const ixs = (
            await Promise.all(b.map((s) => legIxs(s.l, { up, sp, feeds: prices })))
          ).flat();
          return sendTx(ctx, user, ixs);
        },
        () => progress("wait", i),
      );
      for (const s of b) hasAta.set(s.l.mint, true);
      signatures.push(sig);
      progress("swap", i + 1, sig);
    }
  } catch (e) {
    if (!signatures.length) throw e;
    throw partial(e, {
      message: "Some swaps went through, but not all. The swapped assets are in your wallet.",
      goneSuffix: "The swapped assets are in your wallet.",
      stage: "swap",
      completed: signatures,
      total,
      recovery: ["swap-to-usdc"],
      held: await heldNow(),
    });
  }

  try {
    const after = await fetchTokenBalances(ctx, holdings);
    const maxAmounts = plan.legs.map((l, i) => {
      const h = holdings[i] as Address;
      if (l.mint === usdcMint) return l.usdcIn;
      const d = (after.get(h) ?? 0n) - (before.get(h) ?? 0n);
      return d > 0n ? d : 0n;
    });
    const fresh = await fetchIndex(ctx, index);
    assertJoinable(fresh);
    const freshVal = await valueIndex(ctx, fresh);
    if (freshVal.effectiveSupply === 0n) {
      const fitted = fitInitialAmounts(freshVal, maxAmounts);
      for (const [i, v] of fitted.entries()) maxAmounts[i] = v;
    }
    const r = sharesFor(freshVal, fresh, maxAmounts);
    if (r.initial && r.value < MIN_INITIAL_VALUE)
      throw new UserFacingError("The first deposit must be worth at least $1.");
    if (r.shares <= 0n) throw new UserFacingError("The amount is too small to mint any shares.");
    const minShares = (r.shares * (10_000n - slip)) / 10_000n;
    const ixs = await joinIxs(
      user,
      index,
      fresh,
      maxAmounts,
      minShares > 0n ? minShares : 1n,
      r.initial,
    );
    progress("join", batches.length);
    const alt = await loadAlt(ctx, opts.lookupTable);
    const sig = await sendTx(ctx, user, ixs, {
      lookupTables: alt ? [opts.lookupTable as Address] : undefined,
    });
    signatures.push(sig);
    progress("join", total, sig);
    const shares =
      (await fetchTokenBalances(ctx, [await ata(user.address, fresh.shareMint, TOKEN_PROGRAM)]))
        .values()
        .next().value ?? 0n;
    return { signatures, shares };
  } catch (e) {
    if (!signatures.length) throw e;
    throw partial(e, {
      message:
        "Swapped into the assets, but the join did not complete. Your assets are in your wallet.",
      goneSuffix: "Your assets are in your wallet.",
      stage: "join",
      completed: signatures,
      total,
      recovery: ["finish-join", "swap-to-usdc"],
      held: await heldNow(),
    });
  }
}

export interface HeldJoinPlan {
  initial: boolean;
  /** Wallet balance of each index asset (index order). */
  balances: bigint[];
  /** Shares the wallet's current assets would mint (after the entry fee). */
  shares: bigint;
}

/** What joining with the index assets already in `owner`'s wallet would mint. */
export async function planJoinWithHeld(
  ctx: SolanaCtx,
  owner: Address,
  state: IndexState,
): Promise<HeldJoinPlan> {
  const holdings = await Promise.all(state.assets.map((a) => ata(owner, a.mint, a.tokenProgram)));
  const [bal, val] = await Promise.all([fetchTokenBalances(ctx, holdings), valueIndex(ctx, state)]);
  const balances = holdings.map((h) => bal.get(h) ?? 0n);
  if (val.effectiveSupply === 0n) return { initial: true, balances, shares: 0n };
  return { initial: false, balances, shares: sharesFor(val, state, balances).shares };
}

/**
 * Join with the index assets already in the wallet (e.g. after a zap in whose
 * join step failed). Only the proportional part is deposited; the rest stays.
 */
export async function joinWithHeld(
  ctx: SolanaCtx,
  user: TransactionSigner,
  index: Address,
  opts: {
    slippageBps?: number;
    lookupTable?: Address | null;
    onProgress?: (p: ZapProgress) => void;
  } = {},
): Promise<ZapResult> {
  const slip = BigInt(opts.slippageBps ?? 100);
  const state = await fetchIndex(ctx, index);
  assertJoinable(state);
  const p = await planJoinWithHeld(ctx, user.address, state);
  if (p.initial) {
    // Empty index (e.g. a create whose deposit stopped after the swaps): deposit the held
    // assets trimmed to the target weights.
    const val = await valueIndex(ctx, state);
    p.balances = fitInitialAmounts(val, p.balances);
    const r = sharesFor(val, state, p.balances);
    if (r.value < MIN_INITIAL_VALUE)
      throw new UserFacingError(
        "The assets in your wallet are worth less than the $1 first deposit. Swap them to USDC instead.",
      );
    p.shares = r.shares;
  }
  if (p.shares <= 0n)
    throw new UserFacingError(
      "Your wallet does not hold every asset of this index. Swap them to USDC instead.",
    );
  const minShares = (p.shares * (10_000n - slip)) / 10_000n;
  const ixs = await joinIxs(
    user,
    index,
    state,
    p.balances,
    minShares > 0n ? minShares : 1n,
    p.initial,
  );
  opts.onProgress?.({ step: "join", done: 0, total: 1 });
  const alt = await loadAlt(ctx, opts.lookupTable);
  const sig = await sendTx(ctx, user, ixs, {
    lookupTables: alt ? [opts.lookupTable as Address] : undefined,
  });
  opts.onProgress?.({ step: "join", done: 1, total: 1, signature: sig });
  const shares =
    (await fetchTokenBalances(ctx, [await ata(user.address, state.shareMint, TOKEN_PROGRAM)]))
      .values()
      .next().value ?? 0n;
  return { signatures: [sig], shares };
}

export interface WalletAsset {
  mint: Address;
  tokenProgram: Address;
  decimals: number;
  /** Raw amount. */
  amount: bigint;
  /** Scaled UI multiplier (1 for plain mints). */
  multiplier: number;
}

/** Non-zero wallet balances of `mints` (missing token accounts are skipped). */
export async function walletAssetBalances(
  ctx: SolanaCtx,
  owner: Address,
  mints: Address[],
): Promise<WalletAsset[]> {
  const infos = await fetchMints(ctx, mints);
  const list = mints.map((m) => infos.get(m)).filter((m): m is MintInfo => !!m);
  const holdings = await Promise.all(list.map((m) => ata(owner, m.address, m.programId)));
  const bal = await fetchTokenBalances(ctx, holdings);
  return list
    .map((m, i) => ({
      mint: m.address,
      tokenProgram: m.programId,
      decimals: m.decimals,
      amount: bal.get(holdings[i] as Address) ?? 0n,
      multiplier: m.multiplier,
    }))
    .filter((a) => a.amount > 0n);
}

/**
 * Sell assets in the wallet back to USDC. With `amount` the sale is capped at
 * that raw amount; without it the whole balance is sold. Re-running is safe: it
 * only sells what the wallet still holds.
 */
export async function swapToUsdc(
  ctx: SolanaCtx,
  user: TransactionSigner,
  usdcMint: Address,
  assets: { mint: Address; amount?: bigint }[],
  opts: { slippageBps?: number; onProgress?: (p: ZapProgress) => void } = {},
): Promise<{ signatures: Signature[] }> {
  const slip = BigInt(opts.slippageBps ?? 100);
  const wanted = assets.filter((a) => a.mint !== usdcMint);
  const held = await walletAssetBalances(
    ctx,
    user.address,
    wanted.map((a) => a.mint),
  );
  const items: SellItem[] = held.map((h) => {
    const cap = wanted.find((a) => a.mint === h.mint)?.amount;
    return { ...h, amount: cap !== undefined && cap < h.amount ? cap : h.amount };
  });
  if (!items.length) throw new UserFacingError("There is nothing to swap.");
  await waitForFreshPrices(ctx, [usdcMint, ...items.map((i) => i.mint)]);
  const signatures: Signature[] = [];
  let done = 0;
  const total = Math.max(1, Math.ceil(items.length / 4));
  await sellAll(
    ctx,
    user,
    usdcMint,
    items,
    slip,
    signatures,
    (sig) => opts.onProgress?.({ step: "swap", done: ++done, total, signature: sig }),
    () => opts.onProgress?.({ step: "wait", done, total }),
  );
  if (!signatures.length)
    throw new UserFacingError("These balances are too small to swap to USDC.");
  return { signatures };
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
  if (shares <= 0n) throw new UserFacingError("Enter an amount of shares greater than zero.");
  const state = await fetchIndex(ctx, index);
  assertRedeemable(state);
  const plan = await planZapOut(ctx, state, usdcMint, shares);
  if (plan.amounts.every((a) => a === 0n))
    throw new UserFacingError(
      "This amount is too small to redeem any assets. Enter more shares — nothing was sent.",
    );
  const mints = state.assets.map((a) => a.mint);
  const holdings = await Promise.all(
    state.assets.map((a) => ata(user.address, a.mint, a.tokenProgram)),
  );
  const [before, exists] = await Promise.all([
    fetchTokenBalances(ctx, holdings),
    existing(ctx, holdings),
  ]);
  const { redeem } = await redeemIxs(
    user,
    index,
    state,
    shares,
    plan.amounts.map((a) => (a * (10_000n - slip)) / 10_000n),
  );
  // Only the missing asset accounts are created, folded into the redeem tx when it fits.
  const missing: Instruction[] = [];
  for (const [i, a] of state.assets.entries())
    if (!exists[i]) missing.push(await createAtaIx(user, user.address, a.mint, a.tokenProgram));
  const alt = await loadAlt(ctx, opts.lookupTable);
  const lookupTables = alt ? [opts.lookupTable as Address] : undefined;
  let pre: Instruction[][] = [];
  let main: Instruction[] = [redeem];
  if (missing.length) {
    if (fits(user.address, [...missing, redeem], alt)) main = [...missing, redeem];
    else
      pre = pack(
        user.address,
        missing.map((ix) => [ix]),
      );
  }
  const swapsNeeded = opts.toUsdc !== false;
  if (swapsNeeded)
    await waitForFreshPrices(ctx, [usdcMint, ...mints], () =>
      opts.onProgress?.({ step: "wait", done: 0, total: pre.length + 2 }),
    );
  const total = pre.length + 1 + (swapsNeeded ? 1 : 0);
  const signatures: Signature[] = [];
  let done = 0;
  // Creating token accounts moves no value, so a failure up to (and including)
  // the redeem leaves nothing to recover.
  for (const b of pre) {
    signatures.push(await sendTx(ctx, user, b));
    opts.onProgress?.({ step: "prepare", done: ++done, total });
  }
  signatures.push(await sendTx(ctx, user, main, { lookupTables }));
  opts.onProgress?.({ step: "redeem", done: ++done, total, signature: signatures.at(-1) });
  if (!swapsNeeded) return { signatures, shares: 0n };

  try {
    // Sell exactly what the redeem delivered (the balance delta), never older holdings.
    const received = deltas(mints, holdings, before, await fetchTokenBalances(ctx, holdings));
    const infos = new Map(state.assets.map((a) => [a.mint, a]));
    const items: SellItem[] = received
      .filter((r) => r.mint !== usdcMint)
      .map((r) => {
        const a = infos.get(r.mint) as IndexState["assets"][number];
        return {
          mint: r.mint,
          tokenProgram: a.tokenProgram,
          decimals: a.decimals,
          amount: r.amount,
        };
      });
    await sellAll(ctx, user, usdcMint, items, slip, signatures, undefined, () =>
      opts.onProgress?.({ step: "wait", done, total }),
    );
  } catch (e) {
    let held: { mint: Address; amount: bigint }[] = [];
    try {
      held = deltas(mints, holdings, before, await fetchTokenBalances(ctx, holdings)).filter(
        (h) => h.mint !== usdcMint,
      );
    } catch {
      // best effort
    }
    throw partial(e, {
      message: "Redeemed, but swapping to USDC did not complete. The assets are in your wallet.",
      goneSuffix: "The redeemed assets are in your wallet.",
      stage: "swap",
      completed: signatures,
      total,
      recovery: ["swap-to-usdc"],
      held,
    });
  }
  opts.onProgress?.({ step: "swap", done: total, total, signature: signatures.at(-1) });
  return { signatures, shares: 0n };
}

/**
 * SOL a zap in needs from `owner`: rent for each token account it must create
 * (one per swapped asset + the share account) plus fees and a small buffer.
 */
export async function estimateZapInLamports(
  ctx: SolanaCtx,
  owner: Address,
  assets: { mint: Address; tokenProgram: Address }[],
  shareMint: Address,
  usdcMint: Address,
): Promise<{ missingAccounts: number; lamports: bigint }> {
  const swapped = assets.filter((a) => a.mint !== usdcMint);
  const accounts = await Promise.all([
    ...swapped.map((a) => ata(owner, a.mint, a.tokenProgram)),
    ata(owner, shareMint, TOKEN_PROGRAM),
  ]);
  const missingAccounts = (await existing(ctx, accounts)).filter((e) => !e).length;
  const txs = BigInt(Math.ceil(swapped.length / 3) + 1);
  return {
    missingAccounts,
    lamports: BigInt(missingAccounts) * ATA_RENT_LAMPORTS + txs * 20_000n + 1_000_000n,
  };
}
