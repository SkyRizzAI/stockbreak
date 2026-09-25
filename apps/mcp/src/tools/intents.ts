/**
 * Human-in-the-loop tools (PLAN §7.6): store a sign intent and return a link.
 * The /sign page builds fresh transactions when the user is ready.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { createIntent, getIntent } from "@repo/db";
import { isAddress } from "@solana/kit";
import * as z from "zod";
import type { McpCtx } from "../ctx";
import { type CreateSpec, createSchema, toCreateParams } from "../spec";
import { checkUsdcLimit, ok, resolveIndex, safe, usd } from "../util";
import type { IndexDetail } from "./types";

const TTL_MS = 30 * 60_000;

/**
 * A parent's target weights as clone input. A pre-IPO asset that has since listed is
 * replaced by its listed stock (weights merged), the way the vault migrated the parent.
 */
function parentComposition(
  c: McpCtx,
  assets: { symbol: string; targetWeightBps: number }[],
): { symbol: string; weightPct: number }[] {
  const ipos = c.deployment().ipos;
  const out = new Map<string, number>();
  for (const x of assets) {
    if (x.targetWeightBps <= 0) continue;
    const sym = ipos[x.symbol]?.newSymbol ?? x.symbol;
    out.set(sym, (out.get(sym) ?? 0) + x.targetWeightBps / 100);
  }
  return [...out].map(([symbol, weightPct]) => ({ symbol, weightPct }));
}
const wallet = z
  .string()
  .refine((v) => isAddress(v), "Not a Solana address")
  .optional()
  .describe("Only this wallet may sign (optional)");

export async function store(c: McpCtx, kind: string, params: Record<string, unknown>, w?: string) {
  const id = crypto.randomUUID();
  await createIntent(c.db, {
    id,
    kind,
    params,
    wallet: w ?? null,
    createdBy: c.agent?.address ?? "mcp",
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  return {
    intentId: id,
    signUrl: `${c.env.WEB_URL}/sign?id=${id}`,
    expiresInMinutes: TTL_MS / 60_000,
  };
}

export const next =
  "Send the signUrl to the user. They review and sign in their wallet; poll get_intent_status for the result.";

export function registerIntentTools(s: McpServer, ctx: () => Promise<McpCtx>): void {
  s.registerTool(
    "build_join",
    {
      title: "Prepare a join",
      description: `Prepare joining an index with USDC (zapped into its assets). Returns a link the user opens to sign. ${next}`,
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol"),
        usdc: z.number().min(1, "Joins start at $1 USDC").describe("USDC amount (at least 1)"),
        wallet,
      }),
    },
    safe(async ({ index, usdc, wallet: w }) => {
      const c = await ctx();
      checkUsdcLimit(c, usdc);
      const ref = await resolveIndex(c, index);
      const r = await store(
        c,
        "join",
        { index: ref.pubkey, usdc, indexName: ref.name, indexSymbol: ref.symbol },
        w,
      );
      return ok(`Join ${ref.symbol} with ${usd(usdc)}: ask the user to open ${r.signUrl}`, r);
    }),
  );

  s.registerTool(
    "build_redeem",
    {
      title: "Prepare a redeem",
      description: `Prepare redeeming index shares for USDC (or the underlying assets). ${next}`,
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol"),
        shares: z.number().positive().describe("Number of index shares to redeem"),
        toUsdc: z.boolean().default(true).describe("Swap the assets back to USDC"),
        wallet,
      }),
    },
    safe(async ({ index, shares, toUsdc, wallet: w }) => {
      const raw = BigInt(Math.floor(shares * 1e6));
      if (raw <= 0n) throw new Error("shares must be at least 0.000001.");
      const c = await ctx();
      const ref = await resolveIndex(c, index);
      const r = await store(
        c,
        "redeem",
        {
          index: ref.pubkey,
          shares: String(raw),
          toUsdc,
          indexName: ref.name,
          indexSymbol: ref.symbol,
        },
        w,
      );
      return ok(`Redeem ${shares} ${ref.symbol} shares: ask the user to open ${r.signUrl}`, r);
    }),
  );

  s.registerTool(
    "build_create_index",
    {
      title: "Prepare a new index",
      description: `Prepare creating an index the user will own (creator fees go to them). Validates assets and weights. ${next}`,
      inputSchema: createSchema.extend({ wallet }),
    },
    safe(async (args) => {
      const c = await ctx();
      if (args.depositUsdc) checkUsdcLimit(c, args.depositUsdc);
      const params = toCreateParams(c, args as CreateSpec);
      const r = await store(c, "create_index", params, args.wallet);
      return ok(
        `Create ${params.name} (${params.symbol}) with ${params.assets.map((a) => `${a.symbol} ${a.weightBps / 100}%`).join(", ")}: ask the user to open ${r.signUrl}`,
        r,
      );
    }),
  );

  s.registerTool(
    "build_clone",
    {
      title: "Prepare a clone",
      description: `Prepare cloning an index: same composition and rules unless overridden. A clone pays a royalty on its fees to the parent creator. With follow=true its weights keep syncing to the parent. ${next}`,
      inputSchema: z.object({
        parent: z.string().describe("Parent index address or symbol"),
        name: z.string().trim().min(1).max(32).optional(),
        symbol: z
          .string()
          .regex(/^[A-Z0-9]{1,10}$/)
          .optional(),
        follow: z.boolean().default(false).describe("Keep weights synced with the parent"),
        assets: createSchema.shape.assets
          .optional()
          .describe("Override weights (ignored when follow=true)"),
        depositUsdc: createSchema.shape.depositUsdc,
        wallet,
      }),
    },
    safe(async (a) => {
      const c = await ctx();
      if (a.depositUsdc) checkUsdcLimit(c, a.depositUsdc);
      const ref = await resolveIndex(c, a.parent);
      const p = await c.web<IndexDetail>(`/api/indexes/${ref.pubkey}`);
      const spec: CreateSpec = {
        name: a.name ?? `${p.name} Remix`.slice(0, 32),
        symbol: a.symbol ?? `${p.symbol.slice(0, 9)}R`,
        description: `Clone of ${p.name}.`,
        assets: a.assets && !a.follow ? a.assets : parentComposition(c, p.assets),
        strategy: {
          mode: p.strategy.mode as "Manual" | "Threshold" | "Periodic",
          driftThresholdPct: p.strategy.driftThresholdBps / 100 || 5,
          periodDays: Math.max(1, p.strategy.periodSecs / 86_400),
          maxSlippagePct: p.strategy.maxSlippageBps / 100,
          cooldownMinutes: p.strategy.cooldownSecs / 60,
          allowKeeper: p.strategy.allowKeeper,
        },
        fees: {
          managementPct: p.fees.mgmtFeeBps / 100,
          entryPct: p.fees.entryFeeBps / 100,
          exitPct: p.fees.exitFeeBps / 100,
        },
        depositUsdc: a.depositUsdc,
      };
      const params = toCreateParams(c, spec, { address: p.pubkey, follow: a.follow });
      const r = await store(c, "clone", params, a.wallet);
      return ok(
        `Clone ${p.symbol} as ${params.name} (${params.symbol})${a.follow ? ", following the parent" : ""}: ask the user to open ${r.signUrl}`,
        r,
      );
    }),
  );

  s.registerTool(
    "get_intent_status",
    {
      title: "Intent status",
      description:
        "Check whether the user signed a prepared request: pending, in_progress, executed, failed or expired, with signatures.",
      inputSchema: z.object({ intentId: z.string().uuid() }),
      annotations: { readOnlyHint: true },
    },
    safe(async ({ intentId }) => {
      const c = await ctx();
      const it = await getIntent(c.db, intentId);
      if (!it) throw new Error("Intent not found.");
      const exp = new Date(it.expiresAt).getTime();
      // Started flows get an hour of grace past expiry (same rule as the web /sign page).
      const expired =
        (it.status === "pending" && exp < Date.now()) ||
        ((it.status === "in_progress" || it.status === "failed") && exp + 3_600_000 < Date.now());
      const status = expired ? "expired" : it.status;
      const st = ((it.params ?? {}) as { _state?: { index?: string } })._state;
      const index =
        (it.kind === "create_index" || it.kind === "clone") && st?.index ? st.index : null;
      return ok(
        `Intent ${intentId}: ${status}.${index && status === "executed" ? ` New index: ${index}.` : ""}`,
        {
          kind: it.kind,
          status,
          wallet: it.wallet,
          signatures: it.signatures,
          expiresAt: new Date(it.expiresAt).toISOString(),
          result: index ? { index } : null,
        },
      );
    }),
  );
}
