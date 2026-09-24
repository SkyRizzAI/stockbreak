/**
 * Rebalance planner + sandwich builder (PLAN §6.3). The planner mirrors the
 * on-chain trigger rules so keepers only send transactions that can succeed.
 */

import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import { getTransferCheckedInstruction } from "@solana-program/token-2022";
import type { IndexState, Valuation } from "./accounts";
import * as vault from "./generated/index-vault";
import { beginRebalanceIx, createAtaIx, endRebalanceIx, swapIx } from "./instructions";
import * as math from "./math";
import { ata } from "./pda";

export interface RebalancePlan {
  triggered: boolean;
  reason: string;
  assetOut: number;
  assetIn: number;
  amountOut: bigint;
  expectedIn: bigint;
  minIn: bigint;
  valueMoved: bigint;
  driftBefore: number;
  driftAfter: number;
}

export interface PlanOptions {
  /** Executor is a keeper (not creator/manager): trigger + PreIpo rules apply. */
  keeper: boolean;
  now: bigint;
  spreadBps: number;
}

export function triggerMet(
  state: IndexState,
  val: Valuation,
  now: bigint,
): { ok: boolean; reason: string } {
  const s = state.strategy;
  if (s.mode === vault.StrategyMode.Manual)
    return { ok: false, reason: "Manual strategy: keepers never rebalance" };
  if (s.mode === vault.StrategyMode.Threshold) {
    const ok = val.driftMax > s.driftThresholdBps;
    return { ok, reason: `max drift ${val.driftMax} bps vs threshold ${s.driftThresholdBps} bps` };
  }
  const since = now - state.lastRebalanceTs;
  return {
    ok: since >= BigInt(s.periodSecs),
    reason: `${since}s since last rebalance vs period ${s.periodSecs}s`,
  };
}

export function planRebalance(
  state: IndexState,
  val: Valuation,
  o: PlanOptions,
): RebalancePlan | null {
  const s = state.strategy;
  if (state.paused) return null;
  if (o.now - state.lastRebalanceTs < BigInt(s.cooldownSecs)) return null;
  const trig = triggerMet(state, val, o.now);
  if (o.keeper && (!s.allowKeeper || !trig.ok)) {
    return {
      triggered: false,
      reason: s.allowKeeper ? trig.reason : "keeper not allowed",
      assetOut: -1,
      assetIn: -1,
      amountOut: 0n,
      expectedIn: 0n,
      minIn: 0n,
      valueMoved: 0n,
      driftBefore: val.driftSum,
      driftAfter: val.driftSum,
    };
  }
  const eligible = val.assets
    .map((a, i) => ({ a, i, gap: a.weightBps - a.targetBps }))
    .filter((x) => !(o.keeper && x.a.entry.kind === vault.AssetKind.PreIpo));
  if (eligible.length < 2) return null;
  const over = eligible.reduce((m, x) => (x.gap > m.gap ? x : m));
  const under = eligible.reduce((m, x) => (x.gap < m.gap ? x : m));
  if (over.gap <= 0 || under.gap >= 0 || over.i === under.i) return null;
  const excess = (BigInt(over.gap) * val.nav) / 10_000n;
  const deficit = (BigInt(-under.gap) * val.nav) / 10_000n;
  const move = excess < deficit ? excess : deficit;
  return planPair(
    val,
    over.i,
    under.i,
    move,
    o.spreadBps,
    o.keeper ? trig.reason : "manual (creator/manager)",
  );
}

/**
 * Plan selling `valueMicroUsd` of asset `out` for asset `in` at oracle prices,
 * predicting the resulting drift with the program's integer math.
 */
export function planPair(
  val: Valuation,
  out: number,
  inn: number,
  valueMicroUsd: bigint,
  spreadBps: number,
  reason = "custom",
): RebalancePlan | null {
  const oa = val.assets[out];
  const ia = val.assets[inn];
  if (!oa || !ia || out === inn) return null;
  let amountOut =
    math.rawForValue(valueMicroUsd, oa.entry.decimals, oa.mint.multFp, {
      price: oa.feed.price,
      expo: oa.feed.expo,
    }) ?? 0n;
  if (amountOut > oa.entry.balance) amountOut = oa.entry.balance;
  if (amountOut === 0n) return null;
  const expectedIn =
    math.swapOut(
      amountOut,
      oa.entry.decimals,
      oa.mint.multFp,
      { price: oa.feed.price, expo: oa.feed.expo },
      ia.entry.decimals,
      ia.mint.multFp,
      { price: ia.feed.price, expo: ia.feed.expo },
      spreadBps,
    ) ?? 0n;
  if (expectedIn === 0n) return null;
  // Predict drift after using the same integer math as the program.
  const values = val.assets.map((a, i) => {
    let bal = a.entry.balance;
    if (i === out) bal -= amountOut;
    if (i === inn) bal += expectedIn;
    return (
      math.valueUsd(bal, a.entry.decimals, a.mint.multFp, {
        price: a.feed.price,
        expo: a.feed.expo,
      }) ?? 0n
    );
  });
  const [driftAfter] = math.drift(
    values,
    val.assets.map((a) => a.targetBps),
  ) ?? [val.driftSum, 0];
  return {
    triggered: true,
    reason,
    assetOut: out,
    assetIn: inn,
    amountOut,
    expectedIn,
    minIn: (expectedIn * 99n) / 100n,
    valueMoved: valueMicroUsd,
    driftBefore: val.driftSum,
    driftAfter,
  };
}

/** [executor ATAs, begin, swap, transfer_checked(executor → vault), end]. */
export async function rebalanceIxs(
  executor: TransactionSigner,
  index: Address,
  state: IndexState,
  plan: RebalancePlan,
): Promise<Instruction[]> {
  const o = state.assets[plan.assetOut] as vault.AssetEntry;
  const i = state.assets[plan.assetIn] as vault.AssetEntry;
  return [
    await createAtaIx(executor, executor.address, o.mint, o.tokenProgram),
    await createAtaIx(executor, executor.address, i.mint, i.tokenProgram),
    await beginRebalanceIx(
      executor,
      index,
      state,
      plan.assetOut,
      plan.amountOut,
      plan.assetIn,
      plan.minIn,
    ),
    await swapIx(
      executor,
      { mint: o.mint, tokenProgram: o.tokenProgram },
      { mint: i.mint, tokenProgram: i.tokenProgram },
      plan.amountOut,
      plan.expectedIn,
    ),
    getTransferCheckedInstruction(
      {
        source: await ata(executor.address, i.mint, i.tokenProgram),
        mint: i.mint,
        destination: await ata(index, i.mint, i.tokenProgram),
        authority: executor,
        amount: plan.expectedIn,
        decimals: i.decimals,
      },
      { programAddress: i.tokenProgram },
    ),
    await endRebalanceIx(executor, index, state, plan.assetIn),
  ];
}
