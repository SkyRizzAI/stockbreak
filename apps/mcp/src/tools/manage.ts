/**
 * Assistant-mode index management (D048): the agent prepares, the user signs at /sign.
 * Every tool is a single-step intent bound to the wallet the program accepts
 * (the creator; the parent creator for royalties). The web server re-checks on chain.
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { chainClock, fetchIndex, type IndexState, managersOf, parentOf } from "@repo/sdk";
import { type Address, isAddress } from "@solana/kit";
import * as z from "zod";
import type { McpCtx } from "../ctx";
import {
  describeUpdate,
  managersInput,
  planUpdate,
  proposeInput,
  resolveManagers,
  snapOf,
} from "../manage";
import { investableMint, ok, resolveIndex, safe } from "../util";
import { next, store } from "./intents";
import type { ClientConfig, IndexDetail } from "./types";

const wallet = z
  .string()
  .refine((v) => isAddress(v), "Not a Solana address")
  .optional()
  .describe("The user's wallet, if known: checked against who may sign (optional)");

const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const iso = (secs: number) => new Date(secs * 1000).toISOString();

interface Loaded {
  ref: { pubkey: string; name: string; symbol: string };
  st: IndexState;
}

async function load(c: McpCtx, index: string): Promise<Loaded> {
  const ref = await resolveIndex(c, index);
  return { ref, st: await fetchIndex(c, ref.pubkey as Address) };
}

/** Creator-only actions: the request is bound to the creator's wallet. */
function creatorOnly(l: Loaded, action: string, w?: string): string {
  if (w && w !== l.st.creator)
    throw new Error(
      `Not allowed (403): only the creator of ${l.ref.symbol} (${shortAddr(l.st.creator)}) can ${action}. ${shortAddr(w)} is not the creator.`,
    );
  return l.st.creator;
}

function noTicket(l: Loaded): void {
  if (l.st.rebalanceTicket.__option === "Some")
    throw new Error(`${l.ref.symbol} is rebalancing right now. Try again in a minute.`);
}

const base = (l: Loaded) => ({
  index: l.ref.pubkey,
  indexName: l.ref.name,
  indexSymbol: l.ref.symbol,
});

export function registerManageTools(s: McpServer, ctx: () => Promise<McpCtx>): void {
  s.registerTool(
    "build_propose_update",
    {
      title: "Prepare an index update",
      description: `Prepare new target weights, fees and/or strategy for an index the user created. Only listed, non-benchmark assets; at most 10; fees ≤ 5% mgmt / 1% entry / 1% exit; slippage 0.5–5%; drift > 0 and ≤ 50%. Changes apply after the timelock (fee-only cuts apply at once); a new proposal replaces a pending one. ${next}`,
      inputSchema: proposeInput.extend({ wallet }),
    },
    safe(async ({ wallet: w, ...input }) => {
      const c = await ctx();
      const l = await load(c, input.index);
      const creator = creatorOnly(l, "propose updates", w);
      noTicket(l);
      const plan = planUpdate(snapOf(l.st, c.symbolOf), input, (sym) => {
        const mint = investableMint(c, sym);
        return { mint, symbol: c.symbolOf(mint) ?? sym };
      });
      const cfg = await c.web<ClientConfig>("/api/config");
      const timelockSecs = cfg.params.timelockSecs;
      const r = await store(
        c,
        "propose_update",
        { ...base(l), creator, ...plan, timelockSecs },
        creator,
      );
      const when = plan.immediate
        ? "Fee cuts apply as soon as it is signed."
        : timelockSecs > 0
          ? `After signing it can be applied in ${Math.round(timelockSecs / 3600)}h (build_apply_update).`
          : "No timelock here: apply it right after signing with build_apply_update.";
      return ok(
        `Update ${l.ref.symbol}: ${describeUpdate(plan)}. ${when}${plan.replacesPending ? " It replaces the pending update." : ""} Ask the creator to open ${r.signUrl}`,
        { ...r, signer: creator, update: plan, timelockSecs },
      );
    }),
  );

  s.registerTool(
    "build_apply_update",
    {
      title: "Prepare applying an update",
      description: `Prepare applying an index's pending update once its timelock has passed. Any wallet may sign (it pays the fee). ${next}`,
      inputSchema: z.object({ index: z.string().describe("Index address or symbol"), wallet }),
    },
    safe(async ({ index, wallet: w }) => {
      const c = await ctx();
      const l = await load(c, index);
      if (l.st.pendingUpdate.__option !== "Some")
        throw new Error(`${l.ref.symbol} has no pending update. Propose one first.`);
      noTicket(l);
      const eta = Number(l.st.pendingUpdate.value.eta);
      const now = Number(await chainClock(c));
      if (eta > now)
        throw new Error(
          `Too early: the update to ${l.ref.symbol} can be applied after ${iso(eta)} (in ${Math.ceil((eta - now) / 60)} min, chain time).`,
        );
      const d = await c.web<IndexDetail>(`/api/indexes/${l.ref.pubkey}`);
      const r = await store(c, "apply_update", { ...base(l), eta, pending: d.pending }, w);
      return ok(
        `Apply the pending update to ${l.ref.symbol}: ask the user to open ${r.signUrl}`,
        r,
      );
    }),
  );

  s.registerTool(
    "build_cancel_update",
    {
      title: "Prepare cancelling an update",
      description: `Prepare cancelling an index's pending update (creator only). ${next}`,
      inputSchema: z.object({ index: z.string().describe("Index address or symbol"), wallet }),
    },
    safe(async ({ index, wallet: w }) => {
      const c = await ctx();
      const l = await load(c, index);
      const creator = creatorOnly(l, "cancel updates", w);
      if (l.st.pendingUpdate.__option !== "Some")
        throw new Error(`${l.ref.symbol} has no pending update to cancel.`);
      noTicket(l);
      const d = await c.web<IndexDetail>(`/api/indexes/${l.ref.pubkey}`);
      const r = await store(
        c,
        "cancel_update",
        {
          ...base(l),
          creator,
          eta: Number(l.st.pendingUpdate.value.eta),
          pending: d.pending,
        },
        creator,
      );
      return ok(
        `Cancel the pending update to ${l.ref.symbol}: ask the creator to open ${r.signUrl}`,
        { ...r, signer: creator },
      );
    }),
  );

  s.registerTool(
    "build_set_paused",
    {
      title: "Prepare pausing or resuming",
      description: `Prepare pausing (stops joins and rebalances; redeem always works) or resuming an index (creator only). ${next}`,
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol"),
        paused: z.boolean().describe("true = pause, false = resume"),
        wallet,
      }),
    },
    safe(async ({ index, paused, wallet: w }) => {
      const c = await ctx();
      const l = await load(c, index);
      const creator = creatorOnly(l, paused ? "pause it" : "resume it", w);
      if (l.st.paused === paused)
        throw new Error(`${l.ref.symbol} is already ${paused ? "paused" : "active"}.`);
      noTicket(l);
      const r = await store(c, "set_paused", { ...base(l), creator, paused }, creator);
      return ok(
        `${paused ? "Pause" : "Resume"} ${l.ref.symbol}: ask the creator to open ${r.signUrl}`,
        { ...r, signer: creator },
      );
    }),
  );

  s.registerTool(
    "build_set_managers",
    {
      title: "Prepare setting managers",
      description: `Prepare replacing an index's manager list (creator only). Managers may rebalance the index; they cannot change weights, fees or withdraw. At most 3; pass [] to remove all. Entries are wallet addresses or registered agent names. ${next}`,
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol"),
        managers: managersInput,
        wallet,
      }),
    },
    safe(async ({ index, managers, wallet: w }) => {
      const c = await ctx();
      const l = await load(c, index);
      const creator = creatorOnly(l, "set managers", w);
      noTicket(l);
      const needsLookup = managers.some((m) => !isAddress(m));
      const agents = needsLookup
        ? await c.web<{ wallet: string; agentName: string | null; handle: string | null }[]>(
            "/api/agents",
          )
        : [];
      const after = resolveManagers(managers, agents, creator);
      const before = managersOf(l.st) as string[];
      if (before.length === after.length && before.every((m, i) => m === after[i]))
        throw new Error(`${l.ref.symbol} already has exactly these managers.`);
      const label = (a: string) => {
        const g = agents.find((x) => x.wallet === a);
        return g?.agentName ? `${g.agentName} (${shortAddr(a)})` : a;
      };
      const r = await store(
        c,
        "set_managers",
        { ...base(l), creator, before, managers: after, labels: after.map(label) },
        creator,
      );
      const list = (xs: string[]) => (xs.length ? xs.map(shortAddr).join(", ") : "none");
      return ok(
        `Managers of ${l.ref.symbol}: ${list(before)} → ${list(after)}. Ask the creator to open ${r.signUrl}`,
        { ...r, signer: creator, before, after },
      );
    }),
  );

  s.registerTool(
    "build_claim_fees",
    {
      title: "Prepare claiming fees",
      description: `Prepare claiming earned fees as index shares. kind "creator" (default): the creator's fees of an index. kind "royalty": the clone royalty a clone owes its parent's creator; pass the clone index. ${next}`,
      inputSchema: z.object({
        index: z.string().describe("Index address or symbol (for royalty: the clone)"),
        kind: z.enum(["creator", "royalty"]).default("creator"),
        wallet,
      }),
    },
    safe(async ({ index, kind, wallet: w }) => {
      const c = await ctx();
      const l = await load(c, index);
      noTicket(l);
      let claimer: string;
      let parent: string | null = null;
      let owed: bigint;
      if (kind === "creator") {
        claimer = creatorOnly(l, "claim its creator fees", w);
        owed = l.st.owedCreatorShares;
      } else {
        parent = parentOf(l.st);
        if (!parent) {
          const d = await c.web<IndexDetail>(`/api/indexes/${l.ref.pubkey}`);
          throw new Error(
            `${l.ref.symbol} is not a clone, so it owes no royalty. Pass the clone index instead${d.children.length ? `: ${d.children.map((x) => x.symbol).join(", ")}` : ""}.`,
          );
        }
        const p = await fetchIndex(c, parent as Address);
        claimer = p.creator;
        if (w && w !== claimer)
          throw new Error(
            `Not allowed (403): only the parent's creator (${shortAddr(claimer)}) can claim the royalty of ${l.ref.symbol}.`,
          );
        owed = l.st.owedParentShares;
      }
      if (owed === 0n && l.st.fees.mgmtFeeBps === 0)
        throw new Error(`Nothing to claim on ${l.ref.symbol}: no fees owed or accruing.`);
      const r = await store(
        c,
        "claim_fees",
        { ...base(l), kind, parent, claimer, owedShares: owed.toString() },
        claimer,
      );
      return ok(
        `Claim ${kind === "royalty" ? "royalty" : "creator fees"} on ${l.ref.symbol} (${Number(owed) / 1e6} shares owed so far, plus accrued): ask ${shortAddr(claimer)} to open ${r.signUrl}`,
        { ...r, signer: claimer, owedShares: Number(owed) / 1e6 },
      );
    }),
  );
}
