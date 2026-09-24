/** Shared input schema + conversion for index creation (intents and agent wallet). */
import * as z from "zod";
import type { McpCtx } from "./ctx";
import { mintFor, toBps } from "./util";

export const assetsSchema = z
  .array(
    z.object({
      symbol: z.string().describe("Asset symbol from list_assets, e.g. NVDAx"),
      weightPct: z
        .number()
        .positive()
        .describe("Target weight in percent; weights are normalized to 100"),
    }),
  )
  .min(1)
  .max(10);

export const strategySchema = z
  .object({
    mode: z
      .enum(["Manual", "Threshold", "Periodic"])
      .default("Threshold")
      .describe("Manual = hold; Threshold = rebalance on drift; Periodic = on a schedule"),
    driftThresholdPct: z.number().min(0.5).max(50).default(5),
    periodDays: z.number().min(1).max(365).default(7),
    maxSlippagePct: z.number().min(0.5).max(5).default(1),
    cooldownMinutes: z.number().min(0).max(10_080).default(1),
    allowKeeper: z
      .boolean()
      .default(true)
      .describe("Let the platform keeper rebalance when triggered"),
  })
  .prefault({});

export const feesSchema = z
  .object({
    managementPct: z
      .number()
      .min(0)
      .max(5)
      .default(1)
      .describe("Yearly, paid to the creator in shares"),
    entryPct: z.number().min(0).max(1).default(0),
    exitPct: z.number().min(0).max(1).default(0),
  })
  .prefault({});

export const createSchema = z.object({
  name: z.string().trim().min(1).max(32),
  symbol: z
    .string()
    .regex(/^[A-Z0-9]{1,10}$/, "Use 1-10 uppercase letters or digits")
    .describe("Share token symbol, e.g. CHIPS"),
  description: z.string().max(200).optional(),
  assets: assetsSchema,
  strategy: strategySchema,
  fees: feesSchema,
  depositUsdc: z
    .number()
    .min(0)
    .optional()
    .describe("Optional first deposit in USDC (zapped into the assets)"),
});

export type CreateSpec = z.infer<typeof createSchema>;

const bp = (pct: number) => Math.round(pct * 100);

/** The params shape stored in sign_intents (matches apps/web lib/server/steps CreateParams). */
export function toCreateParams(
  c: McpCtx,
  s: CreateSpec,
  parent?: { address: string; follow: boolean },
) {
  const weights = toBps(s.assets);
  const seen = new Set<string>();
  const assets = s.assets.map((a, i) => {
    const mint = mintFor(c, a.symbol);
    if (seen.has(mint)) throw new Error(`${a.symbol} is listed twice.`);
    seen.add(mint);
    return { mint, symbol: c.symbolOf(mint) ?? a.symbol, weightBps: weights[i] as number };
  });
  return {
    name: s.name,
    symbol: s.symbol,
    description: s.description,
    assets,
    fees: {
      mgmtFeeBps: bp(s.fees.managementPct),
      entryFeeBps: bp(s.fees.entryPct),
      exitFeeBps: bp(s.fees.exitPct),
    },
    strategy: {
      mode: s.strategy.mode,
      driftThresholdBps: bp(s.strategy.driftThresholdPct),
      periodSecs: Math.round(s.strategy.periodDays * 86_400),
      maxSlippageBps: bp(s.strategy.maxSlippagePct),
      cooldownSecs: Math.round(s.strategy.cooldownMinutes * 60),
      allowKeeper: s.strategy.allowKeeper,
    },
    parent: parent?.address ?? null,
    followsParent: parent?.follow ?? false,
    depositUsdc: s.depositUsdc && s.depositUsdc > 0 ? s.depositUsdc : undefined,
  };
}

export type CreateParams = ReturnType<typeof toCreateParams>;

/** Partial updates: unset fields keep the index's current value (no defaults here). */
export const strategyPatchSchema = z.object({
  mode: z.enum(["Manual", "Threshold", "Periodic"]).optional(),
  driftThresholdPct: z.number().min(0.5).max(50).optional(),
  periodDays: z.number().min(1).max(365).optional(),
  maxSlippagePct: z.number().min(0.5).max(5).optional(),
  cooldownMinutes: z.number().min(0).max(10_080).optional(),
  allowKeeper: z.boolean().optional(),
});

export const feesPatchSchema = z.object({
  managementPct: z.number().min(0).max(5).optional(),
  entryPct: z.number().min(0).max(1).optional(),
  exitPct: z.number().min(0).max(1).optional(),
});
