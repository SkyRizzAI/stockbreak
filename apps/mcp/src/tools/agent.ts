/**
 * Agent wallet tools (PLAN §7.6): enabled when AGENT_KEYPAIR_PATH is set.
 * The agent signs with its own keypair; the vault program enforces the mandate.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { CLUSTER_PARAMS, explorerTx } from "@repo/config";
import {
  createPost,
  getIndex,
  getUser,
  registerAgent,
  setIndexMeta,
  setLookupTable,
} from "@repo/db";
import {
  applyUpdateIx,
  ata,
  cancelUpdateIx,
  chainClock,
  claimFeesIxs,
  createIndexFlow,
  describeError,
  faucetIxs,
  fetchIndex,
  fetchMaybeIndex,
  fetchTokenBalances,
  indexPda,
  managersOf,
  nextIndexId,
  parentOf,
  pendingResult,
  proposeUpdateIx,
  rebalanceIxs,
  sendTx,
  TOKEN_PROGRAM,
  vault,
  zapIn,
  zapOut,
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
import {
  AGENT_POST_LIMITS,
  CARD_VARIANTS,
  checkAgentRate,
  checkContent,
  normalizeBody,
  POST_MAX,
} from "../social";
import { createSchema, feesPatchSchema, strategyPatchSchema, toCreateParams } from "../spec";
import {
  bps,
  checkUsdcLimit,
  investableMint,
  mintFor,
  ok,
  resolveIndex,
  safe,
  toBps,
  usd,
} from "../util";

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

const fmtShares = (raw: bigint) => (Number(raw) / 1e6).toFixed(4);

/** Share balance (raw, 6 decimals) of `who`; 0n when the account is missing. */
async function shareBalance(c: McpCtx, who: Address, shareMint: Address): Promise<bigint> {
  const account = await ata(who, shareMint, TOKEN_PROGRAM);
  return (await fetchTokenBalances(c, [account])).get(account) ?? 0n;
}

async function balances(c: McpCtx, who: Address) {
  const usdc = mintFor(c, "USDC");
  const account = await ata(who, usdc, TOKEN_PROGRAM);
  const [sol, tokens] = await Promise.all([
    c.rpc.getBalance(who, { commitment: "confirmed" }).send(),
    fetchTokenBalances(c, [account]),
  ]);
  // fetchTokenBalances returns a Map keyed by token account.
  return { sol: Number(sol.value) / 1e9, usdc: Number(tokens.get(account) ?? 0n) / 1e6 };
}

/** Wait until the indexer has stored a new index row (for metadata writes). */
async function waitIndexed(c: McpCtx, index: Address, ms = 30_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await getIndex(c.db, index)) return true;
    await new Promise((r) => setTimeout(r, 1_000));
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
        `Stockbreak agent registration\nwallet: ${a.address}\nname: ${name}\nts: ${Date.now()}`,
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
      const indexId = await nextIndexId(c, a.address);
      const r = await createIndexFlow(c, {
        creator: a,
        indexId,
        name: p.name,
        symbol: p.symbol,
        // Keyed by address: symbols are not unique.
        uri: `${c.env.WEB_URL}/api/meta/${await indexPda(a.address, indexId)}`,
        assets: p.assets.map((x) => ({ mint: x.mint, weightBps: x.weightBps })),
        fees: p.fees,
        strategy: { ...p.strategy, mode: MODE[p.strategy.mode] },
        parent: null,
        followsParent: false,
      });
      // The metadata route syncs the row from chain when the worker has not indexed it yet.
      if (
        (await waitIndexed(c, r.index, 5_000)) ||
        (await c.web(`/api/meta/${r.index}`).then(
          () => true,
          () => false,
        ))
      ) {
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
      // As documented: only indexes the agent created or manages (keeper duty is the platform's).
      if (as.role === "keeper")
        throw new Error(
          `The agent is not the creator or a manager of ${ref.symbol}. Ask its creator to add the agent as a manager.`,
        );
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
      let nextAssets = assets?.map((x, i) => ({
        mint: investableMint(c, x.symbol),
        weightBps: weights[i] as number,
      }));
      // The vault cannot drop an asset it still holds: keep omitted funded assets at 0%
      // (the keeper then sells them down) instead of failing at apply time.
      const kept: string[] = [];
      if (nextAssets)
        for (const e of st.assets)
          if (e.balance > 0n && !nextAssets.some((x) => x.mint === e.mint)) {
            nextAssets = [...nextAssets, { mint: e.mint, weightBps: 0 }];
            kept.push(c.symbolOf(e.mint) ?? e.mint.slice(0, 4));
          }
      if (nextAssets && nextAssets.length > 10)
        throw new Error(
          `Too many assets: ${kept.join(", ")} still hold a balance and must stay (at 0%) until sold. Keep at most ${10 - kept.length} new targets.`,
        );
      const ix = await proposeUpdateIx(a, ref.pubkey as Address, st, {
        assets: nextAssets,
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
      const key = (x: typeof st) =>
        x.pendingUpdate.__option === "Some"
          ? JSON.stringify(x.pendingUpdate.value, (_k, v) => (typeof v === "bigint" ? `${v}` : v))
          : "";
      const proposed = await sendTx(c, a, [ix]);
      const after = await fetchIndex(c, ref.pubkey as Address);
      // A fee-only cut applies immediately and leaves any older pending update untouched:
      // only a pending update this call created (or replaced) may be applied below.
      if (!key(after) || key(after) === key(st))
        return ok(`Fee change on ${ref.symbol} is live (fee cuts apply immediately).`, {
          proposed: tx(c, proposed),
          pendingUnchanged: !!key(after),
        });
      const eta =
        after.pendingUpdate.__option === "Some" ? Number(after.pendingUpdate.value.eta) : 0;
      const now = Number(await chainClock(c));
      if (eta <= now) {
        try {
          const applied = await sendTx(
            c,
            a,
            [await applyUpdateIx(a, ref.pubkey as Address, after)],
            { computeUnitLimit: 600_000 },
          );
          return ok(
            `Updated ${ref.symbol} (no timelock on ${c.env.CLUSTER}).${kept.length ? ` Kept ${kept.join(", ")} at 0% until the vault sells them.` : ""}`,
            {
              proposed: tx(c, proposed),
              applied: tx(c, applied),
              strategyMode: MODE_NAME[after.strategy.mode],
            },
          );
        } catch (e) {
          throw new Error(
            `Proposed an update to ${ref.symbol}, but applying it failed: ${describeError(e)}. The proposal is still pending; propose a corrected update (it replaces this one) or withdraw it with agent_cancel_update.`,
          );
        }
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

  s.registerTool(
    "agent_post",
    {
      title: "Agent: post to the feed",
      description: `Publish a short post to the Stockbreak social feed from the agent wallet, optionally attached to an index (shown as an index card with cardVariant). Use it to explain every rebalance or proposed update in plain words. Rules: at most ${POST_MAX} characters, at most 2 links, no duplicates within 24 h, one agent post per minute, ${AGENT_POST_LIMITS.perDay} per day. The agent must be registered (agent_register).`,
      inputSchema: z.object({
        body: z.string().min(1).max(2_000).describe(`Post text, at most ${POST_MAX} characters`),
        index: z.string().optional().describe("Attach an index (address or symbol)"),
        cardVariant: z
          .enum(CARD_VARIANTS)
          .optional()
          .describe("Show the attached index as a card: mark | tokens | chart"),
      }),
    },
    safe(async ({ body: raw, index, cardVariant }) => {
      const c = await ctx();
      const a = agentOf(c);
      const user = await getUser(c.db, a.address);
      if (!user?.isAgent)
        throw new Error(
          "The agent wallet is not registered yet. Call agent_register with a display name first, then post.",
        );
      const body = normalizeBody(raw);
      const bad = checkContent(body);
      if (bad) throw new Error(bad);
      if (cardVariant && !index) throw new Error("cardVariant needs an attached index.");
      const ref = index ? await resolveIndex(c, index) : null;
      const limited = await checkAgentRate(c.db, a.address, body);
      if (limited) throw new Error(limited);
      const row = await createPost(c.db, {
        author: a.address,
        body,
        index: ref?.pubkey ?? null,
        cardVariant: ref ? (cardVariant ?? null) : null,
      });
      const url = ref ? `${c.env.WEB_URL}/i/${ref.pubkey}` : `${c.env.WEB_URL}/u/${a.address}`;
      return ok(`Posted to the feed${ref ? ` on ${ref.symbol}` : ""} (post #${row.id}).`, {
        postId: row.id,
        url,
        feedUrl: `${c.env.WEB_URL}/feed`,
        index: ref ? { address: ref.pubkey, symbol: ref.symbol } : null,
        cardVariant: row.cardVariant,
        body,
      });
    }),
  );
  s.registerTool(
    "agent_redeem",
    {
      title: "Agent: redeem shares",
      description:
        "Redeem the agent wallet's own shares of an index: pass shares or pct (1–100, default 100). With toUsdc (default) the redeemed assets are swapped back to USDC; otherwise they stay in the agent wallet as tokens.",
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol"),
        shares: z.number().positive().optional().describe("Number of shares to redeem"),
        pct: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe("Percent of the agent's shares to redeem (1–100)"),
        toUsdc: z.boolean().default(true).describe("Swap redeemed assets back to USDC"),
      }),
    },
    safe(async ({ index, shares, pct, toUsdc }) => {
      const c = await ctx();
      const a = agentOf(c);
      if (shares !== undefined && pct !== undefined)
        throw new Error("Pass either shares or pct, not both.");
      const ref = await resolveIndex(c, index);
      const st = await fetchIndex(c, ref.pubkey as Address);
      const held = await shareBalance(c, a.address, st.shareMint);
      if (held === 0n) throw new Error(`The agent holds no ${ref.symbol} shares to redeem.`);
      const amount =
        shares !== undefined
          ? BigInt(Math.round(shares * 1e6))
          : (held * BigInt(Math.round((pct ?? 100) * 100))) / 10_000n;
      if (amount <= 0n) throw new Error("That amount rounds to zero shares.");
      if (amount > held)
        throw new Error(
          `The agent holds ${fmtShares(held)} ${ref.symbol} shares; cannot redeem ${fmtShares(amount)}.`,
        );
      const usdcMint = mintFor(c, "USDC");
      const before = (await balances(c, a.address)).usdc;
      const row = await getIndex(c.db, ref.pubkey);
      const r = await zapOut(c, a, ref.pubkey as Address, usdcMint, amount, {
        toUsdc,
        lookupTable: (row?.lookupTable as Address | null) ?? null,
      });
      const after = (await balances(c, a.address)).usdc;
      const received = Math.max(0, after - before);
      return ok(
        toUsdc
          ? `Redeemed ${fmtShares(amount)} ${ref.symbol} shares for ${usd(received)} USDC.`
          : `Redeemed ${fmtShares(amount)} ${ref.symbol} shares; the assets are in the agent wallet.`,
        {
          redeemedShares: Number(amount) / 1e6,
          remainingShares: Number(held - amount) / 1e6,
          usdcReceived: toUsdc ? received : null,
          ...tx(c, r.signatures.at(-1) as string),
          signatures: r.signatures,
        },
      );
    }),
  );

  s.registerTool(
    "agent_claim_fees",
    {
      title: "Agent: claim fees",
      description:
        "Claim the fees owed to the agent on an index, paid as index shares: creator fees when the agent created it, and clone royalties when the agent created its parent index. Fees accrue first, so this also collects the latest management fee.",
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol where the fees are owed"),
      }),
    },
    safe(async ({ index }) => {
      const c = await ctx();
      const a = agentOf(c);
      const ref = await resolveIndex(c, index);
      const st = await fetchIndex(c, ref.pubkey as Address);
      const parent = parentOf(st);
      const parentSt = parent ? await fetchMaybeIndex(c, parent) : null;
      const kinds: { kind: vault.FeeKind; label: string; owed: bigint; parent?: Address }[] = [];
      if (st.creator === a.address)
        kinds.push({
          kind: vault.FeeKind.Creator,
          label: "creator fees",
          owed: st.owedCreatorShares,
        });
      if (parent && parentSt?.creator === a.address)
        kinds.push({
          kind: vault.FeeKind.Parent,
          label: "clone royalties",
          owed: st.owedParentShares,
          parent,
        });
      if (!kinds.length)
        throw new Error(
          `The agent is not the creator of ${ref.symbol}${parent ? " or of its parent index" : ""}, so no fees are owed to it there.`,
        );
      // Owed shares only grow over time through the management fee (accrued on claim).
      const due = kinds.filter((k) => k.owed > 0n || st.fees.mgmtFeeBps > 0);
      if (!due.length)
        return ok(`Nothing to claim on ${ref.symbol}: no fees are owed to the agent yet.`, {
          claimedShares: 0,
        });
      const ixs = [];
      for (const [i, k] of due.entries()) {
        const [createAta, claim] = await claimFeesIxs(
          a,
          ref.pubkey as Address,
          st,
          k.kind,
          k.parent,
        );
        if (i === 0 && createAta) ixs.push(createAta);
        if (claim) ixs.push(claim);
      }
      const before = await shareBalance(c, a.address, st.shareMint);
      const sig = await sendTx(c, a, ixs);
      const claimed = (await shareBalance(c, a.address, st.shareMint)) - before;
      const price = await c
        .web<{ sharePriceLive: number }>(`/api/indexes/${ref.pubkey}`)
        .then((d) => d.sharePriceLive)
        .catch(() => null);
      const value = price === null ? null : (Number(claimed) / 1e6) * price;
      return ok(
        claimed > 0n
          ? `Claimed ${fmtShares(claimed)} ${ref.symbol} shares${value === null ? "" : ` (≈ ${usd(value)})`} of ${due.map((k) => k.label).join(" and ")}.`
          : `Nothing was owed on ${ref.symbol}; the claim went through with 0 shares.`,
        {
          claimedShares: Number(claimed) / 1e6,
          valueUsd: value,
          kinds: due.map((k) => k.label),
          ...tx(c, sig),
        },
      );
    }),
  );

  s.registerTool(
    "agent_apply_update",
    {
      title: "Agent: apply update",
      description:
        "Apply the pending update (weights, strategy or fees) of an index the agent created or manages once its timelock has passed. Before that it explains when the update can be applied.",
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol"),
      }),
    },
    safe(async ({ index }) => {
      const c = await ctx();
      const a = agentOf(c);
      const ref = await resolveIndex(c, index);
      const st = await fetchIndex(c, ref.pubkey as Address);
      if (st.creator !== a.address && !managersOf(st).includes(a.address))
        throw new Error(`The agent is not the creator or a manager of ${ref.symbol}.`);
      if (st.pendingUpdate.__option !== "Some")
        throw new Error(`${ref.symbol} has no pending update to apply.`);
      const eta = Number(st.pendingUpdate.value.eta);
      const now = Number(await chainClock(c));
      if (eta > now) {
        const mins = Math.ceil((eta - now) / 60);
        return {
          content: [
            {
              type: "text" as const,
              text: `The update to ${ref.symbol} is still timelocked: it can be applied after ${new Date(eta * 1000).toISOString()} (about ${mins} min from now). Nothing was sent.`,
            },
          ],
          isError: true,
        };
      }
      const next = pendingResult(st);
      const sig = await sendTx(c, a, [await applyUpdateIx(a, ref.pubkey as Address, st)], {
        computeUnitLimit: 600_000,
      });
      return ok(`Applied the pending update to ${ref.symbol}.`, {
        targets:
          next?.map((x) => ({
            symbol: c.symbolOf(x.mint) ?? x.mint,
            weight: bps(x.targetWeightBps),
          })) ?? null,
        ...tx(c, sig),
      });
    }),
  );

  s.registerTool(
    "agent_cancel_update",
    {
      title: "Agent: cancel update",
      description:
        "Cancel the pending update of an index the agent created (creator only). The current weights, strategy and fees stay in place.",
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol"),
      }),
    },
    safe(async ({ index }) => {
      const c = await ctx();
      const a = agentOf(c);
      const ref = await resolveIndex(c, index);
      const st = await fetchIndex(c, ref.pubkey as Address);
      if (st.creator !== a.address)
        throw new Error(`Only the creator of ${ref.symbol} can cancel its pending update.`);
      if (st.pendingUpdate.__option !== "Some")
        throw new Error(`${ref.symbol} has no pending update to cancel.`);
      const sig = await sendTx(c, a, [await cancelUpdateIx(a, ref.pubkey as Address)]);
      return ok(`Cancelled the pending update to ${ref.symbol}.`, tx(c, sig));
    }),
  );

  s.registerTool(
    "agent_get_test_usdc",
    {
      title: "Agent: get test USDC",
      description:
        "Mint simulated test USDC to the agent wallet from the mock market faucet (no real value). The agent signs and pays the fee, so it needs a little SOL.",
      inputSchema: z.object({
        amount: z.number().positive().default(1_000).describe("USDC to mint (default 1,000)"),
      }),
    },
    safe(async ({ amount }) => {
      const c = await ctx();
      const a = agentOf(c);
      const max = Number(CLUSTER_PARAMS[c.env.CLUSTER].faucetMaxUsdc / 1_000_000n);
      if (amount > max)
        throw new Error(`At most ${usd(max)} test USDC per request on ${c.env.CLUSTER}.`);
      const usdcMint = mintFor(c, "USDC");
      const account = await ata(a.address, usdcMint, TOKEN_PROGRAM);
      const [{ value: existing }, before] = await Promise.all([
        c.rpc.getAccountInfo(account, { encoding: "base64", commitment: "confirmed" }).send(),
        balances(c, a.address),
      ]);
      // Fee, plus rent for the USDC account when it does not exist yet.
      if (before.sol < (existing ? 0.00001 : 0.0021))
        throw new Error(
          `The agent wallet has ${before.sol.toFixed(4)} SOL, not enough for the fee. Fund it with SOL first (Agents page → Fund SOL).`,
        );
      const sig = await sendTx(
        c,
        a,
        await faucetIxs(a, usdcMint, BigInt(Math.round(amount * 1e6))),
      );
      const after = await balances(c, a.address);
      return ok(`Minted ${usd(amount)} simulated USDC to the agent. Balance: ${usd(after.usdc)}.`, {
        minted: amount,
        balances: after,
        ...tx(c, sig),
      });
    }),
  );
}
