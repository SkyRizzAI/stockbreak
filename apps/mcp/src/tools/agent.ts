/**
 * Agent wallet tools (PLAN §7.6): enabled when AGENT_KEYPAIR_PATH is set.
 * The agent signs with its own keypair; the vault program enforces the mandate.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { explorerTx } from "@repo/config";
import { getIndex, getUser, registerAgent, setIndexMeta, setLookupTable } from "@repo/db";
import {
  applyUpdateIx,
  ata,
  chainClock,
  createIndexFlow,
  fetchIndex,
  fetchTokenBalances,
  nextIndexId,
  proposeUpdateIx,
  rebalanceIxs,
  sendTx,
  TOKEN_PROGRAM,
  vault,
  zapIn,
} from "@repo/sdk";
import {
  type Address,
  getBase58Decoder,
  type KeyPairSigner,
  signBytes,
  verifySignature,
} from "@solana/kit";
import * as z from "zod";
import type { McpCtx } from "../ctx";
import { assess, describe, ensureLookupTable } from "../rebalance";
import { createSchema, feesPatchSchema, strategyPatchSchema, toCreateParams } from "../spec";
import { bps, checkUsdcLimit, mintFor, ok, resolveIndex, safe, toBps, usd } from "../util";

const MODE = {
  Manual: vault.StrategyMode.Manual,
  Threshold: vault.StrategyMode.Threshold,
  Periodic: vault.StrategyMode.Periodic,
} as const;
const MODE_NAME = ["Manual", "Threshold", "Periodic"] as const;

function agentOf(c: McpCtx): KeyPairSigner {
  if (!c.agent)
    throw new Error("Agent wallet mode is off. Set AGENT_KEYPAIR_PATH to enable agent_* tools.");
  return c.agent;
}

const tx = (c: McpCtx, sig: string) => ({
  signature: sig,
  explorer: explorerTx(c.env.CLUSTER, sig, c.env.RPC_URL),
});

async function balances(c: McpCtx, who: Address) {
  const usdc = mintFor(c, "USDC");
  const [sol, [raw]] = await Promise.all([
    c.rpc.getBalance(who, { commitment: "confirmed" }).send(),
    fetchTokenBalances(c, [await ata(who, usdc, TOKEN_PROGRAM)]),
  ]);
  return { sol: Number(sol.value) / 1e9, usdc: Number(raw ?? 0n) / 1e6 };
}

/** Wait until the indexer has stored a new index row (for metadata writes). */
async function waitIndexed(c: McpCtx, index: Address, ms = 30_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await getIndex(c.db, index)) return true;
    await Bun.sleep(1_000);
  }
  return false;
}

export function registerAgentTools(s: McpServer, ctx: () => Promise<McpCtx>): void {
  s.registerTool(
    "agent_info",
    {
      title: "Agent wallet",
      description:
        "The agent wallet: address, SOL/USDC balance, registration, indexes it created or manages, and per-action limits.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const c = await ctx();
      const a = agentOf(c);
      const [bal, user, managed] = await Promise.all([
        balances(c, a.address),
        getUser(c.db, a.address),
        c.web<
          {
            wallet: string;
            created: { pubkey: string; symbol: string }[];
            managed: { pubkey: string; symbol: string }[];
          }[]
        >("/api/agents"),
      ]);
      const me = managed.find((x) => x.wallet === a.address);
      return ok(
        `Agent ${a.address} on ${c.env.CLUSTER}: ${bal.sol.toFixed(3)} SOL, ${usd(bal.usdc)} USDC.`,
        {
          address: a.address,
          cluster: c.env.CLUSTER,
          registered: user?.isAgent ?? false,
          agentName: user?.agentName ?? null,
          balances: bal,
          created: me?.created.map((x) => ({ address: x.pubkey, symbol: x.symbol })) ?? [],
          manages: me?.managed.map((x) => ({ address: x.pubkey, symbol: x.symbol })) ?? [],
          limits: { maxUsdcPerAction: c.env.MCP_MAX_USDC_PER_ACTION },
        },
      );
    }),
  );

  s.registerTool(
    "agent_register",
    {
      title: "Register agent",
      description:
        "Mark the agent wallet as an AI agent (shown with an AI badge, ranked in the AI leaderboard). Proves ownership by signing a message.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(40).describe("Display name, e.g. Atlas"),
      }),
    },
    safe(async ({ name }) => {
      const c = await ctx();
      const a = agentOf(c);
      const message = new TextEncoder().encode(
        `Stocklana agent registration\nwallet: ${a.address}\nname: ${name}\nts: ${Date.now()}`,
      );
      const sig = await signBytes(a.keyPair.privateKey, message);
      if (!(await verifySignature(a.keyPair.publicKey, sig, message)))
        throw new Error("Signature check failed.");
      const u = await registerAgent(c.db, a.address, name);
      return ok(`Registered ${u.agentName} (${a.address}) as an AI agent.`, {
        wallet: a.address,
        agentName: u.agentName,
        proof: getBase58Decoder().decode(sig),
      });
    }),
  );

  s.registerTool(
    "agent_create_index",
    {
      title: "Agent: create index",
      description:
        "Create an index owned by the agent wallet, optionally with a first USDC deposit. The agent becomes the creator and earns its fees.",
      inputSchema: createSchema,
    },
    safe(async (spec) => {
      const c = await ctx();
      const a = agentOf(c);
      if (spec.depositUsdc) checkUsdcLimit(c, spec.depositUsdc);
      const p = toCreateParams(c, spec);
      const r = await createIndexFlow(c, {
        creator: a,
        indexId: await nextIndexId(c, a.address),
        name: p.name,
        symbol: p.symbol,
        uri: `${c.env.WEB_URL}/api/meta/${p.symbol}`,
        assets: p.assets.map((x) => ({ mint: x.mint, weightBps: x.weightBps })),
        fees: p.fees,
        strategy: { ...p.strategy, mode: MODE[p.strategy.mode] },
        parent: null,
        followsParent: false,
      });
      if (await waitIndexed(c, r.index)) {
        if (r.lookupTable) await setLookupTable(c.db, r.index, r.lookupTable);
        if (p.description) await setIndexMeta(c.db, r.index, { description: p.description });
      }
      let deposit: { shares: number; signatures: string[] } | null = null;
      if (p.depositUsdc) {
        const z0 = await zapIn(
          c,
          a,
          r.index,
          mintFor(c, "USDC"),
          BigInt(Math.round(p.depositUsdc * 1e6)),
          {
            lookupTable: r.lookupTable,
          },
        );
        deposit = { shares: Number(z0.shares) / 1e6, signatures: z0.signatures };
      }
      return ok(`Created ${p.name} (${p.symbol}) at ${r.index}.`, {
        address: r.index,
        url: `${c.env.WEB_URL}/i/${r.index}`,
        create: tx(c, r.signatures.at(-1) as string),
        deposit,
      });
    }),
  );

  s.registerTool(
    "agent_join",
    {
      title: "Agent: join index",
      description: "Deposit USDC from the agent wallet into an index (zapped into its assets).",
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol"),
        usdc: z.number().positive(),
      }),
    },
    safe(async ({ index, usdc }) => {
      const c = await ctx();
      const a = agentOf(c);
      checkUsdcLimit(c, usdc);
      const ref = await resolveIndex(c, index);
      const row = await getIndex(c.db, ref.pubkey);
      const r = await zapIn(
        c,
        a,
        ref.pubkey as Address,
        mintFor(c, "USDC"),
        BigInt(Math.round(usdc * 1e6)),
        {
          lookupTable: (row?.lookupTable as Address | null) ?? null,
        },
      );
      return ok(
        `Joined ${ref.symbol} with ${usd(usdc)}: ${(Number(r.shares) / 1e6).toFixed(4)} shares.`,
        {
          shares: Number(r.shares) / 1e6,
          ...tx(c, r.signatures.at(-1) as string),
        },
      );
    }),
  );

  s.registerTool(
    "agent_rebalance",
    {
      title: "Agent: rebalance",
      description:
        "Rebalance an index the agent created or manages. Without sell/buy it executes the suggested swap (see simulate_rebalance). The program rejects swaps that break the mandate (wrong direction, slippage, cooldown, pause).",
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol"),
        sell: z.string().optional().describe("Asset symbol to sell (custom swap)"),
        buy: z.string().optional().describe("Asset symbol to buy (custom swap)"),
        amountUsd: z.number().positive().optional().describe("Value to move for a custom swap"),
      }),
    },
    safe(async ({ index, sell, buy, amountUsd }) => {
      const c = await ctx();
      const a = agentOf(c);
      const ref = await resolveIndex(c, index);
      const custom =
        sell || buy || amountUsd
          ? { sell: sell ?? "", buy: buy ?? "", amountUsd: amountUsd ?? 0 }
          : undefined;
      if (custom && (!custom.sell || !custom.buy || !(custom.amountUsd > 0)))
        throw new Error("A custom swap needs sell, buy and amountUsd.");
      const as = await assess(c, ref.pubkey as Address, a.address, custom);
      if (!as.allowed || !as.plan) {
        const why = [
          ...as.checks.filter((x) => !x.ok).map((x) => x.detail),
          ...(as.simulation?.error ? [`Program: ${as.simulation.error}`] : []),
        ];
        return {
          content: [
            {
              type: "text" as const,
              text: `Rebalance rejected for ${ref.symbol}: ${why.join(" ")}\n\n${JSON.stringify(describe(c, as), null, 2)}`,
            },
          ],
          isError: true,
        };
      }
      const ixs = await rebalanceIxs(a, as.index, as.state, as.plan);
      const alt = await ensureLookupTable(c, a, as, ixs);
      const sig = await sendTx(c, a, ixs, {
        lookupTables: alt ? [alt] : undefined,
        computeUnitLimit: 800_000,
      });
      const d = describe(c, as);
      return ok(
        `Rebalanced ${ref.symbol}: sold ${d.suggested?.sell} for ${d.suggested?.buy} (${usd(d.suggested?.valueUsd ?? 0)}), drift ${bps(as.plan.driftBefore)} → ${bps(as.plan.driftAfter)}.`,
        { ...d, ...tx(c, sig) },
      );
    }),
  );

  s.registerTool(
    "agent_propose_update",
    {
      title: "Agent: propose update",
      description:
        "Propose new target weights, strategy or fees for an index the agent created. Changes apply after the timelock; when the timelock is zero (localnet) it is applied right away.",
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol"),
        assets: createSchema.shape.assets.optional().describe("New composition and target weights"),
        strategy: strategyPatchSchema.optional().describe("Only the fields to change"),
        fees: feesPatchSchema.optional().describe("Only the fields to change"),
      }),
    },
    safe(async ({ index, assets, strategy, fees }) => {
      const c = await ctx();
      const a = agentOf(c);
      const ref = await resolveIndex(c, index);
      const st = await fetchIndex(c, ref.pubkey as Address);
      if (st.creator !== a.address)
        throw new Error(`Only the creator can propose updates to ${ref.symbol}.`);
      if (!assets && !strategy && !fees) throw new Error("Nothing to update.");
      const weights = assets ? toBps(assets) : [];
      const ix = await proposeUpdateIx(a, ref.pubkey as Address, st, {
        assets: assets?.map((x, i) => ({
          mint: mintFor(c, x.symbol),
          weightBps: weights[i] as number,
        })),
        fees: fees
          ? {
              mgmtFeeBps:
                fees.managementPct !== undefined
                  ? Math.round(fees.managementPct * 100)
                  : st.fees.mgmtFeeBps,
              entryFeeBps:
                fees.entryPct !== undefined ? Math.round(fees.entryPct * 100) : st.fees.entryFeeBps,
              exitFeeBps:
                fees.exitPct !== undefined ? Math.round(fees.exitPct * 100) : st.fees.exitFeeBps,
            }
          : undefined,
        strategy: strategy
          ? {
              mode: strategy.mode ? MODE[strategy.mode] : st.strategy.mode,
              driftThresholdBps:
                strategy.driftThresholdPct !== undefined
                  ? Math.round(strategy.driftThresholdPct * 100)
                  : st.strategy.driftThresholdBps,
              periodSecs:
                strategy.periodDays !== undefined
                  ? Math.round(strategy.periodDays * 86_400)
                  : st.strategy.periodSecs,
              maxSlippageBps:
                strategy.maxSlippagePct !== undefined
                  ? Math.round(strategy.maxSlippagePct * 100)
                  : st.strategy.maxSlippageBps,
              cooldownSecs:
                strategy.cooldownMinutes !== undefined
                  ? Math.round(strategy.cooldownMinutes * 60)
                  : st.strategy.cooldownSecs,
              allowKeeper: strategy.allowKeeper ?? st.strategy.allowKeeper,
            }
          : undefined,
      });
      const proposed = await sendTx(c, a, [ix]);
      const after = await fetchIndex(c, ref.pubkey as Address);
      const eta =
        after.pendingUpdate.__option === "Some" ? Number(after.pendingUpdate.value.eta) : 0;
      const now = Number(await chainClock(c));
      if (eta && eta <= now) {
        const applied = await sendTx(c, a, [await applyUpdateIx(a, ref.pubkey as Address, after)], {
          computeUnitLimit: 600_000,
        });
        return ok(`Updated ${ref.symbol} (no timelock on ${c.env.CLUSTER}).`, {
          proposed: tx(c, proposed),
          applied: tx(c, applied),
          strategyMode: MODE_NAME[after.strategy.mode],
        });
      }
      return ok(
        `Proposed an update to ${ref.symbol}. It can be applied after ${new Date(eta * 1000).toISOString()}.`,
        {
          proposed: tx(c, proposed),
          appliesAfter: new Date(eta * 1000).toISOString(),
        },
      );
    }),
  );
}
