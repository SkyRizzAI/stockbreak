/**
 * Rebalance assessment shared by simulate_rebalance and agent_rebalance.
 * Mirrors index_vault::begin/end_rebalance checks, then confirms with an RPC
 * simulation so the program itself has the final word.
 */
import { getIndex, setLookupTable } from "@repo/db";
import {
  buildUnsignedTxBase64,
  chainClock,
  createIndexAlt,
  fetchIndex,
  fits,
  type IndexState,
  managersOf,
  market,
  marketPda,
  parseFailure,
  planPair,
  planRebalance,
  type RebalancePlan,
  rebalanceIxs,
  type Valuation,
  valueIndex,
  vault,
} from "@repo/sdk";
import {
  type Address,
  createNoopSigner,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import type { McpCtx } from "./ctx";
import { bps } from "./util";

export interface Check {
  rule: string;
  ok: boolean;
  detail: string;
}

export interface Assessment {
  index: Address;
  state: IndexState;
  val: Valuation;
  role: "creator" | "manager" | "keeper";
  plan: RebalancePlan | null;
  checks: Check[];
  allowed: boolean;
  lookupTable: Address | null;
  simulation: { ok: boolean; error?: string; unitsConsumed?: number } | null;
}

export interface CustomSwap {
  sell: string;
  buy: string;
  amountUsd: number;
}

function assetIndex(c: McpCtx, state: IndexState, symbol: string): number {
  const mint = c.mintOf(symbol);
  const i = mint ? state.assets.findIndex((a) => a.mint === mint) : -1;
  if (i < 0) throw new Error(`${symbol} is not held by ${state.symbol}.`);
  return i;
}

export async function assess(
  c: McpCtx,
  index: Address,
  executor: Address,
  custom?: CustomSwap,
): Promise<Assessment> {
  const state = await fetchIndex(c, index);
  const val = await valueIndex(c, state);
  const spread = (await market.fetchMarket(c.rpc, await marketPda())).data.spreadBps;
  const now = await chainClock(c);
  const role: Assessment["role"] =
    executor === state.creator
      ? "creator"
      : managersOf(state).includes(executor)
        ? "manager"
        : "keeper";
  const keeper = role === "keeper";
  const s = state.strategy;
  const checks: Check[] = [];
  const add = (rule: string, ok: boolean, detail: string) => checks.push({ rule, ok, detail });

  add("not paused", !state.paused, state.paused ? "The index is paused by its creator." : "Active");
  add(
    "no rebalance in progress",
    state.rebalanceTicket.__option === "None",
    state.rebalanceTicket.__option === "None" ? "Free" : "Another rebalance is in progress.",
  );
  const since = now - state.lastRebalanceTs;
  add(
    "cooldown",
    since >= BigInt(s.cooldownSecs),
    since >= BigInt(s.cooldownSecs)
      ? `${since}s since last rebalance (cooldown ${s.cooldownSecs}s)`
      : `Wait ${BigInt(s.cooldownSecs) - since}s more (cooldown ${s.cooldownSecs}s).`,
  );
  add(
    "has shares",
    val.effectiveSupply > 0n,
    val.effectiveSupply > 0n
      ? "Index has deposits"
      : "Nothing to rebalance: the index has no deposits.",
  );

  let plan: RebalancePlan | null;
  if (custom) {
    const out = assetIndex(c, state, custom.sell);
    const inn = assetIndex(c, state, custom.buy);
    if (out === inn) throw new Error("Sell and buy must be different assets.");
    // An amount above the vault balance is capped by the planner (the mandate checks below
    // then judge the capped swap), so the agent still learns why a large swap is rejected.
    plan = planPair(
      val,
      out,
      inn,
      BigInt(Math.round(custom.amountUsd * 1e6)),
      spread,
      "custom swap",
    );
  } else {
    // Pause/cooldown are reported as checks above; plan the pure swap here.
    const p = planRebalance({ ...state, paused: false, lastRebalanceTs: 0n }, val, {
      keeper: false,
      now,
      spreadBps: spread,
      // A keeper executor may not trade pre-IPO tokens: suggest what it can actually do.
      excludePreIpo: keeper,
    });
    plan = p?.triggered ? p : null;
  }
  add(
    "swap available",
    plan !== null,
    plan
      ? `Sell ${sym(c, state, plan.assetOut)} → buy ${sym(c, state, plan.assetIn)}, $${(Number(plan.valueMoved) / 1e6).toFixed(2)}`
      : custom
        ? "The requested swap is empty (zero amount or no balance)."
        : "Weights already match targets; no swap needed.",
  );

  if (keeper) {
    add(
      "executor role",
      s.allowKeeper,
      s.allowKeeper
        ? "Not creator or manager: keeper rules apply"
        : "Not creator or manager, and this index does not allow keepers.",
    );
    const preIpo =
      plan !== null &&
      [plan.assetOut, plan.assetIn].some((i) => state.assets[i]?.kind === vault.AssetKind.PreIpo);
    add(
      "keeper cannot trade pre-IPO",
      !preIpo,
      preIpo ? "Keepers may not trade pre-IPO tokens." : "OK",
    );
    const trig =
      s.mode === vault.StrategyMode.Manual
        ? { ok: false, why: "Manual strategy: only the creator or a manager can rebalance." }
        : s.mode === vault.StrategyMode.Threshold
          ? {
              ok: val.driftMax > s.driftThresholdBps,
              why: `Max drift ${bps(val.driftMax)} vs threshold ${bps(s.driftThresholdBps)}`,
            }
          : {
              ok: since >= BigInt(s.periodSecs),
              why: `${since}s since last rebalance vs period ${s.periodSecs}s`,
            };
    add("trigger", trig.ok, trig.why);
  } else {
    add("executor role", true, `Executor is the ${role}`);
  }

  add(
    "slippage",
    spread <= s.maxSlippageBps,
    `Market spread ${bps(spread)} vs max slippage ${bps(s.maxSlippageBps)}`,
  );
  if (plan)
    add(
      "moves toward targets",
      plan.driftAfter <= plan.driftBefore,
      `Total drift ${bps(plan.driftBefore)} → ${bps(plan.driftAfter)}`,
    );

  const row = await getIndex(c.db, index);
  const lookupTable = (row?.lookupTable as Address | null | undefined) ?? null;
  let simulation: Assessment["simulation"] = null;
  if (plan)
    simulation = await simulate(c, createNoopSigner(executor), index, state, plan, lookupTable);
  const allowed = checks.every((x) => x.ok) && (simulation?.ok ?? false);
  return { index, state, val, role, plan, checks, allowed, lookupTable, simulation };
}

function sym(c: McpCtx, state: IndexState, i: number): string {
  const m = state.assets[i]?.mint;
  return (m && c.symbolOf(m)) ?? `asset #${i}`;
}

async function simulate(
  c: McpCtx,
  executor: TransactionSigner,
  index: Address,
  state: IndexState,
  plan: RebalancePlan,
  lookupTable: Address | null,
): Promise<NonNullable<Assessment["simulation"]>> {
  const ixs: Instruction[] = await rebalanceIxs(executor, index, state, plan);
  if (!fits(executor.address, ixs) && !lookupTable)
    return { ok: true, error: "Needs an address lookup table (created on execution)." };
  const { tx } = await buildUnsignedTxBase64(c, executor.address, ixs, {
    lookupTables: lookupTable ? [lookupTable] : undefined,
    computeUnitLimit: 800_000,
  });
  const r = await c.rpc
    .simulateTransaction(tx, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true })
    .send();
  if (!r.value.err) return { ok: true, unitsConsumed: Number(r.value.unitsConsumed ?? 0) };
  const f = parseFailure(r.value.err, r.value.logs ?? []);
  return {
    ok: false,
    error: f
      ? `${f.message} [${f.program}: ${f.name}]`
      : `Simulation failed: ${JSON.stringify(r.value.err)}`,
  };
}

/** Ensure the index has a lookup table when the rebalance tx needs one (agent pays). */
export async function ensureLookupTable(
  c: McpCtx,
  signer: TransactionSigner,
  a: Assessment,
  ixs: Instruction[],
): Promise<Address | null> {
  if (fits(signer.address, ixs)) return a.lookupTable;
  if (a.lookupTable) return a.lookupTable;
  const alt = await createIndexAlt(c, signer, a.index, a.state.shareMint, a.state.assets);
  await setLookupTable(c.db, a.index, alt);
  return alt;
}

export function describe(c: McpCtx, a: Assessment) {
  return {
    index: a.index,
    symbol: a.state.symbol,
    executorRole: a.role,
    allowed: a.allowed,
    drift: { sum: bps(a.val.driftSum), max: bps(a.val.driftMax) },
    suggested: a.plan
      ? {
          sell: sym(c, a.state, a.plan.assetOut),
          buy: sym(c, a.state, a.plan.assetIn),
          valueUsd: +(Number(a.plan.valueMoved) / 1e6).toFixed(2),
          driftAfter: bps(a.plan.driftAfter),
        }
      : null,
    checks: a.checks,
    programSimulation: a.simulation,
  };
}
