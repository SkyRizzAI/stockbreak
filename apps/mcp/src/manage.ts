/**
 * Pure validation for the assistant-mode "manage" tools (build_propose_update,
 * build_set_managers, …). No chain or DB access here so it can be unit tested.
 * Limits match the Manage UI (apps/web/components/index/manage-view.tsx) and the program.
 */
import { type IndexState, vault } from "@repo/sdk";
import { isAddress } from "@solana/kit";
import * as z from "zod";
import { assetsSchema } from "./spec";
import { toBps } from "./util";

export const MAX_ASSETS = 10;
export const MAX_MANAGERS = 3;
const DEFAULT_PUBKEY = "11111111111111111111111111111111";

export type ModeName = "Manual" | "Threshold" | "Periodic";
const MODE_NAME: Record<vault.StrategyMode, ModeName> = {
  [vault.StrategyMode.Manual]: "Manual",
  [vault.StrategyMode.Threshold]: "Threshold",
  [vault.StrategyMode.Periodic]: "Periodic",
};

/** Same limits as the Manage UI: fees ≤ 5/1/1 %, slippage 0.5–5 %, drift > 0 and ≤ 50 %. */
export const feesInput = z
  .object({
    managementPct: z.number().min(0).max(5, "Management fee: at most 5% a year").optional(),
    entryPct: z.number().min(0).max(1, "Entry fee: at most 1%").optional(),
    exitPct: z.number().min(0).max(1, "Exit fee: at most 1%").optional(),
  })
  .describe("Only the fields to change");

export const strategyInput = z
  .object({
    mode: z.enum(["Manual", "Threshold", "Periodic"]).optional(),
    driftThresholdPct: z
      .number()
      .gt(0, "Drift threshold must be above 0%")
      .max(50, "Drift threshold: at most 50%")
      .optional(),
    periodDays: z.number().gt(0).max(365, "Period: at most 365 days").optional(),
    maxSlippagePct: z
      .number()
      .min(0.5, "Max slippage: between 0.5% and 5%")
      .max(5, "Max slippage: between 0.5% and 5%")
      .optional(),
    cooldownMinutes: z.number().min(0).max(43_200, "Cooldown: at most 30 days").optional(),
    allowKeeper: z.boolean().optional(),
  })
  .describe("Only the fields to change");

export const proposeInput = z.object({
  index: z.string().describe("Index address or symbol (must be the user's own index)"),
  assets: assetsSchema
    .optional()
    .describe(
      "New composition and target weights (normalized to 100). Assets the vault still holds but you leave out are kept at 0% automatically until sold.",
    ),
  fees: feesInput.optional(),
  strategy: strategyInput.optional(),
});
export type ProposeInput = z.infer<typeof proposeInput>;

export interface FeesBps {
  mgmtFeeBps: number;
  entryFeeBps: number;
  exitFeeBps: number;
}
export interface StrategyJson {
  mode: ModeName;
  driftThresholdBps: number;
  periodSecs: number;
  maxSlippageBps: number;
  cooldownSecs: number;
  allowKeeper: boolean;
}

/** The part of the on-chain index the planner needs. */
export interface IndexSnap {
  symbol: string;
  followsParent: boolean;
  hasPending: boolean;
  assets: { mint: string; symbol: string; balance: bigint; targetWeightBps: number }[];
  fees: FeesBps;
  strategy: StrategyJson;
}

export function snapOf(st: IndexState, symbolOf: (mint: string) => string | undefined): IndexSnap {
  return {
    symbol: st.symbol,
    followsParent: st.followsParent,
    hasPending: st.pendingUpdate.__option === "Some",
    assets: st.assets.map((a) => ({
      mint: a.mint,
      symbol: symbolOf(a.mint) ?? a.mint.slice(0, 4),
      balance: a.balance,
      targetWeightBps: a.targetWeightBps,
    })),
    fees: { ...st.fees },
    strategy: { ...st.strategy, mode: MODE_NAME[st.strategy.mode] },
  };
}

/** Params stored in the `propose_update` sign intent (read by apps/web lib/server/steps.ts). */
export interface ProposeParams {
  assets: { mint: string; symbol: string; weightBps: number }[] | null;
  fees: FeesBps | null;
  strategy: StrategyJson | null;
  /** Funded assets left out by the caller and kept at 0% (the vault cannot drop them). */
  kept: string[];
  /** A fee-only cut: applies at once, skipping the timelock. */
  immediate: boolean;
  /** Proposing replaces an older pending update. */
  replacesPending: boolean;
}

export type Resolve = (symbol: string) => { mint: string; symbol: string };

const bp = (pct: number) => Math.round(pct * 100);

/** Validate a propose request against the index and turn it into intent params. */
export function planUpdate(snap: IndexSnap, input: ProposeInput, resolve: Resolve): ProposeParams {
  const { assets, fees, strategy } = input;
  if (!assets && !fees && !strategy)
    throw new Error("Nothing to update: pass assets, fees and/or strategy.");
  let nextAssets: ProposeParams["assets"] = null;
  const kept: string[] = [];
  if (assets) {
    if (snap.followsParent)
      throw new Error(
        `${snap.symbol} follows its parent: its weights sync from the parent. Change fees or strategy instead.`,
      );
    const weights = toBps(assets);
    const seen = new Set<string>();
    nextAssets = assets.map((a, i) => {
      const r = resolve(a.symbol);
      if (seen.has(r.mint)) throw new Error(`${r.symbol} is listed twice.`);
      seen.add(r.mint);
      return { mint: r.mint, symbol: r.symbol, weightBps: weights[i] as number };
    });
    for (const e of snap.assets)
      if (e.balance > 0n && !seen.has(e.mint)) {
        nextAssets.push({ mint: e.mint, symbol: e.symbol, weightBps: 0 });
        kept.push(e.symbol);
      }
    if (nextAssets.length > MAX_ASSETS)
      throw new Error(
        kept.length
          ? `Too many assets: ${kept.join(", ")} still hold a balance and must stay (at 0%) until sold. Keep at most ${MAX_ASSETS - kept.length} new targets.`
          : `At most ${MAX_ASSETS} assets.`,
      );
    const same =
      nextAssets.length === snap.assets.length &&
      nextAssets.every(
        (a, i) =>
          a.mint === snap.assets[i]?.mint && a.weightBps === snap.assets[i]?.targetWeightBps,
      );
    if (same) nextAssets = null;
  }
  let nextFees: FeesBps | null = null;
  if (fees) {
    const f = {
      mgmtFeeBps: fees.managementPct !== undefined ? bp(fees.managementPct) : snap.fees.mgmtFeeBps,
      entryFeeBps: fees.entryPct !== undefined ? bp(fees.entryPct) : snap.fees.entryFeeBps,
      exitFeeBps: fees.exitPct !== undefined ? bp(fees.exitPct) : snap.fees.exitFeeBps,
    };
    const s = snap.fees;
    if (
      f.mgmtFeeBps !== s.mgmtFeeBps ||
      f.entryFeeBps !== s.entryFeeBps ||
      f.exitFeeBps !== s.exitFeeBps
    )
      nextFees = f;
  }
  let nextStrategy: StrategyJson | null = null;
  if (strategy) {
    const s = snap.strategy;
    const n: StrategyJson = {
      mode: strategy.mode ?? s.mode,
      driftThresholdBps:
        strategy.driftThresholdPct !== undefined
          ? bp(strategy.driftThresholdPct)
          : s.driftThresholdBps,
      periodSecs:
        strategy.periodDays !== undefined ? Math.round(strategy.periodDays * 86_400) : s.periodSecs,
      maxSlippageBps:
        strategy.maxSlippagePct !== undefined ? bp(strategy.maxSlippagePct) : s.maxSlippageBps,
      cooldownSecs:
        strategy.cooldownMinutes !== undefined
          ? Math.round(strategy.cooldownMinutes * 60)
          : s.cooldownSecs,
      allowKeeper: strategy.allowKeeper ?? s.allowKeeper,
    };
    if (n.mode === "Threshold" && n.driftThresholdBps <= 0)
      throw new Error("Drift mode needs driftThresholdPct above 0%.");
    if (n.mode === "Periodic" && n.periodSecs <= 0)
      throw new Error("Periodic mode needs periodDays above 0.");
    if (n.maxSlippageBps < 50 || n.maxSlippageBps > 500)
      throw new Error("Max slippage: between 0.5% and 5%.");
    if ((Object.keys(n) as (keyof StrategyJson)[]).some((k) => n[k] !== s[k])) nextStrategy = n;
  }
  if (!nextAssets && !nextFees && !nextStrategy)
    throw new Error(`Nothing changes: ${snap.symbol} already has these settings.`);
  const immediate =
    !nextAssets &&
    !nextStrategy &&
    !!nextFees &&
    nextFees.mgmtFeeBps <= snap.fees.mgmtFeeBps &&
    nextFees.entryFeeBps <= snap.fees.entryFeeBps &&
    nextFees.exitFeeBps <= snap.fees.exitFeeBps;
  return {
    assets: nextAssets,
    fees: nextFees,
    strategy: nextStrategy,
    kept,
    immediate,
    replacesPending: snap.hasPending && !immediate,
  };
}

/** One human line per changed part (tool replies). */
export function describeUpdate(p: ProposeParams): string {
  const out: string[] = [];
  if (p.assets)
    out.push(
      `weights ${p.assets
        .filter((a) => a.weightBps > 0)
        .map((a) => `${a.symbol} ${(a.weightBps / 100).toFixed(1)}%`)
        .join(", ")}${p.kept.length ? ` (kept at 0% until sold: ${p.kept.join(", ")})` : ""}`,
    );
  if (p.fees)
    out.push(
      `fees mgmt ${p.fees.mgmtFeeBps / 100}%/yr, entry ${p.fees.entryFeeBps / 100}%, exit ${p.fees.exitFeeBps / 100}%`,
    );
  if (p.strategy)
    out.push(
      `strategy ${p.strategy.mode}, slippage ${p.strategy.maxSlippageBps / 100}%${p.strategy.mode === "Threshold" ? `, drift ${p.strategy.driftThresholdBps / 100}%` : ""}${p.strategy.mode === "Periodic" ? `, every ${p.strategy.periodSecs / 86_400} days` : ""}, keeper ${p.strategy.allowKeeper ? "on" : "off"}`,
    );
  return out.join("; ");
}

export const managersInput = z
  .array(z.string().trim().min(1))
  .max(MAX_MANAGERS, `At most ${MAX_MANAGERS} managers`)
  .describe(
    "The full new manager list (replaces the current one; [] removes all). Wallet addresses or registered agent names.",
  );

/**
 * Resolve manager entries (addresses or agent names) to unique addresses.
 * `agents` = registered agents (wallet + name) from /api/agents.
 */
export function resolveManagers(
  entries: string[],
  agents: { wallet: string; agentName: string | null; handle: string | null }[],
  creator: string,
): string[] {
  if (entries.length > MAX_MANAGERS) throw new Error(`At most ${MAX_MANAGERS} managers.`);
  const out: string[] = [];
  for (const e of entries) {
    let addr: string;
    if (isAddress(e)) addr = e;
    else {
      const q = e.replace(/^@/, "").toLowerCase();
      const hits = agents.filter(
        (a) => a.agentName?.toLowerCase() === q || a.handle?.toLowerCase() === q,
      );
      if (hits.length === 0)
        throw new Error(
          `"${e}" is neither a Solana address nor a registered agent name. Use the wallet address.`,
        );
      if (hits.length > 1)
        throw new Error(`Several agents are called "${e}". Use the wallet address instead.`);
      addr = (hits[0] as { wallet: string }).wallet;
    }
    if (addr === DEFAULT_PUBKEY) throw new Error("The system program is not a valid manager.");
    if (addr === creator)
      throw new Error("The creator can already manage the index; list other wallets.");
    if (out.includes(addr)) throw new Error(`${e} is listed twice.`);
    out.push(addr);
  }
  return out;
}
