import "server-only";
/**
 * Server-built transaction steps for sign intents (MCP → /sign) and Blinks.
 * Each step returns unsigned v0 transactions (fee payer = the user's wallet);
 * later steps read chain state produced by earlier ones (swap outputs, ALT).
 */
import { getIndex } from "@repo/db";
import {
  applyUpdateIx,
  assertFreshPrices,
  ata,
  buildUnsignedTxBase64,
  cancelUpdateIx,
  chainClock,
  claimFeesIxs,
  createAltIxs,
  createAtaIx,
  createIndexIx,
  fetchIndex,
  fetchMints,
  fetchTokenBalances,
  fitInitialAmounts,
  fits,
  type IndexState,
  indexAltAddresses,
  indexPda,
  joinIxs,
  loadAlt,
  market,
  math,
  pack,
  parentOf,
  planZapIn,
  planZapOut,
  proposeUpdateIx,
  redeemIxs,
  setManagersIx,
  setPausedIx,
  shareMintPda,
  swapIx,
  TOKEN_PROGRAM,
  valueIndex,
  vault,
  waitAltActive,
} from "@repo/sdk";
import { type Address, createNoopSigner, type Instruction, isAddress } from "@solana/kit";
import { chain, db, requireDeployment } from "./ctx";
import { UserError } from "./http";
import { saveLookupTable } from "./index-row";

export interface StepResult {
  step: number;
  label: string;
  txs: string[];
  /** Next step number, or null when this was the last one. */
  next: number | null;
  /** Opaque state to pass back for the next step. */
  state: Record<string, unknown>;
  summary?: string;
}

const $ = (usd: number) => BigInt(Math.round(usd * 1e6));

async function toTxs(
  feePayer: Address,
  batches: Instruction[][],
  lookupTable?: Address | null,
  cu = 600_000,
): Promise<string[]> {
  const c = chain();
  const out: string[] = [];
  for (const b of batches) {
    const r = await buildUnsignedTxBase64(c, feePayer, b, {
      computeUnitLimit: cu,
      lookupTables: lookupTable ? [lookupTable] : undefined,
    });
    out.push(r.tx);
  }
  return out;
}

function usdcMint(): Address {
  return requireDeployment().mints.USDC as Address;
}

async function lookupTableOf(index: string): Promise<Address | null> {
  const row = await getIndex(db(), index);
  const alt = (row?.lookupTable ?? null) as Address | null;
  if (alt && (await loadAlt(chain(), alt))) return alt;
  return null;
}

// ---------------- join (zap in) ----------------

export async function joinStep(
  account: Address,
  index: Address,
  usdc: number,
  step: number,
  state: Record<string, unknown>,
  /** false when re-planning mid-chain (earlier swaps already spent part of the USDC). */
  precheck = true,
): Promise<StepResult> {
  const c = chain();
  const user = createNoopSigner(account);
  const st = await fetchIndex(c, index);
  const usdcM = usdcMint();
  const holdings = await Promise.all(st.assets.map((a) => ata(account, a.mint, a.tokenProgram)));
  if (step === 0 && precheck) {
    // Fail before the wallet is asked to sign anything (the tx would revert anyway).
    if (!Number.isFinite(usdc) || usdc < 1) throw new UserError("Minimum join is $1 USDC");
    if (usdc > 1_000_000) throw new UserError("Maximum join is $1,000,000 USDC");
    if (st.paused) throw new UserError("This index is paused. Joining is disabled for now.", 409);
    if (st.rebalanceTicket.__option === "Some")
      throw new UserError("This index is rebalancing. Try again in a minute.", 409);
    const usdcAta = await ata(account, usdcM, TOKEN_PROGRAM);
    const bal = (await fetchTokenBalances(c, [usdcAta])).get(usdcAta) ?? 0n;
    if (bal < $(usdc))
      throw new UserError(
        `Not enough USDC: this wallet has $${(Number(bal) / 1e6).toFixed(2)}. Get test USDC from the faucet.`,
      );
  }
  if (step === 0) {
    await assertFreshPrices(c, [usdcM, ...st.assets.map((a) => a.mint)]);
    const plan = await planZapIn(c, st, usdcM, $(usdc));
    // The vault needs >= $1 of assets on the first deposit; spread + buffer eat ~1.3%.
    if (plan.initial && usdc < 1.1)
      throw new UserError("The first deposit into an empty index must be at least $1.10");
    if (plan.expectedShares === 0n)
      throw new UserError("This amount is too small to buy any shares");
    const before = await fetchTokenBalances(c, holdings);
    const groups: Instruction[][] = [];
    for (const l of plan.legs) {
      if (l.mint === usdcM || l.usdcIn === 0n) continue;
      groups.push([
        await createAtaIx(user, account, l.mint, l.tokenProgram),
        await swapIx(
          user,
          { mint: usdcM, tokenProgram: TOKEN_PROGRAM },
          { mint: l.mint, tokenProgram: l.tokenProgram },
          l.usdcIn,
          (l.expectedOut * 99n) / 100n,
        ),
      ]);
    }
    return {
      step,
      label: "Swap USDC into the index assets",
      txs: await toTxs(account, pack(account, groups)),
      next: 1,
      state: {
        baseline: holdings.map((h) => (before.get(h) ?? 0n).toString()),
        legs: plan.legs.map((l) => ({ mint: l.mint, usdcIn: l.usdcIn.toString() })),
        expectedShares: plan.expectedShares.toString(),
        initial: plan.initial,
      },
      summary: `Join ${st.symbol} with $${usdc.toLocaleString("en-US")} USDC`,
    };
  }
  const baseline = (state.baseline as string[] | undefined)?.map((x) => BigInt(x)) ?? [];
  const legs = (state.legs as { mint: string; usdcIn: string }[] | undefined) ?? [];
  const now = await fetchTokenBalances(c, holdings);
  const maxAmounts = st.assets.map((a, i) => {
    if (a.mint === usdcM) {
      const leg = BigInt(legs.find((l) => l.mint === a.mint)?.usdcIn ?? "0");
      return leg < $(usdc) ? leg : $(usdc);
    }
    const d = (now.get(holdings[i] as Address) ?? 0n) - (baseline[i] ?? 0n);
    return d > 0n ? d : 0n;
  });
  if (state.initial) {
    // First deposit: trim to the target weights at current prices (swaps landed earlier).
    const fitted = fitInitialAmounts(await valueIndex(c, st), maxAmounts);
    for (const [i, v] of fitted.entries()) maxAmounts[i] = v;
  }
  const expected = BigInt((state.expectedShares as string | undefined) ?? "0");
  // A first deposit mints exactly its (trimmed) value into an empty vault: no price risk to
  // guard against, and the pre-trim estimate would reject a valid join.
  const minShares = state.initial ? 1n : (expected * 98n) / 100n;
  const ixs = await joinIxs(
    user,
    index,
    st,
    maxAmounts,
    minShares > 0n ? minShares : 1n,
    Boolean(state.initial),
  );
  const alt = await lookupTableOf(index);
  return {
    step,
    label: "Join the index",
    txs: await toTxs(account, [ixs], alt),
    next: null,
    state,
  };
}

// ---------------- redeem (zap out) ----------------

export async function redeemStep(
  account: Address,
  index: Address,
  shares: bigint,
  toUsdc: boolean,
  step: number,
  state: Record<string, unknown>,
): Promise<StepResult> {
  const c = chain();
  const user = createNoopSigner(account);
  const st = await fetchIndex(c, index);
  const usdcM = usdcMint();
  const holdings = await Promise.all(st.assets.map((a) => ata(account, a.mint, a.tokenProgram)));
  if (step === 0) {
    if (toUsdc) await assertFreshPrices(c, [usdcM, ...st.assets.map((a) => a.mint)]);
    const plan = await planZapOut(c, st, usdcM, shares);
    const before = await fetchTokenBalances(c, holdings);
    const { atas, redeem } = await redeemIxs(
      user,
      index,
      st,
      shares,
      plan.amounts.map((a) => (a * 99n) / 100n),
    );
    const alt = await lookupTableOf(index);
    const batches = fits(account, [...atas, redeem])
      ? [[...atas, redeem]]
      : [
          ...pack(
            account,
            atas.map((a) => [a]),
          ),
          [redeem],
        ];
    const txs: string[] = [];
    for (const [i, b] of batches.entries())
      txs.push(...(await toTxs(account, [b], i === batches.length - 1 ? alt : null)));
    return {
      step,
      label: "Redeem shares",
      txs,
      next: toUsdc ? 1 : null,
      state: { baseline: holdings.map((h) => (before.get(h) ?? 0n).toString()) },
      summary: `Redeem ${Number(shares) / 1e6} ${st.symbol} shares${toUsdc ? " to USDC" : ""}`,
    };
  }
  const baseline = (state.baseline as string[] | undefined)?.map((x) => BigInt(x)) ?? [];
  const now = await fetchTokenBalances(c, holdings);
  const mints = await fetchMints(
    c,
    st.assets.map((a) => a.mint),
  );
  const spread = (await market.fetchMarket(c.rpc, requireDeployment().market as Address)).data
    .spreadBps;
  const usdcFeed = await market.fetchOracleFeed(c.rpc, requireDeployment().feeds.USDC as Address);
  const groups: Instruction[][] = [];
  for (const [i, a] of st.assets.entries()) {
    if (a.mint === usdcM) continue;
    const got = (now.get(holdings[i] as Address) ?? 0n) - (baseline[i] ?? 0n);
    if (got <= 0n) continue;
    const f = await market.fetchOracleFeed(c.rpc, a.oracle);
    const exp =
      math.swapOut(
        got,
        a.decimals,
        mints.get(a.mint)?.multFp ?? math.MULT_FP,
        { price: f.data.price, expo: f.data.expo },
        6,
        math.MULT_FP,
        { price: usdcFeed.data.price, expo: usdcFeed.data.expo },
        spread,
      ) ?? 0n;
    groups.push([
      await swapIx(
        user,
        { mint: a.mint, tokenProgram: a.tokenProgram },
        { mint: usdcM, tokenProgram: TOKEN_PROGRAM },
        got,
        (exp * 99n) / 100n,
      ),
    ]);
  }
  return {
    step,
    label: "Swap assets back to USDC",
    txs: await toTxs(account, pack(account, groups)),
    next: null,
    state,
  };
}

// ---------------- create / clone ----------------

export interface CreateParams {
  name: string;
  symbol: string;
  description?: string;
  assets: { mint: string; weightBps: number }[];
  fees: { mgmtFeeBps: number; entryFeeBps: number; exitFeeBps: number };
  strategy: {
    mode: "Manual" | "Threshold" | "Periodic";
    driftThresholdBps: number;
    periodSecs: number;
    maxSlippageBps: number;
    cooldownSecs: number;
    allowKeeper: boolean;
  };
  parent?: string | null;
  followsParent?: boolean;
  depositUsdc?: number;
  indexId?: string;
}

const MODE = {
  Manual: vault.StrategyMode.Manual,
  Threshold: vault.StrategyMode.Threshold,
  Periodic: vault.StrategyMode.Periodic,
};

export async function createStep(
  account: Address,
  p: CreateParams,
  step: number,
  state: Record<string, unknown>,
  webUrl: string,
): Promise<StepResult> {
  const c = chain();
  const user = createNoopSigner(account);
  const indexId = BigInt(
    (state.indexId as string | undefined) ?? p.indexId ?? Date.now().toString(),
  );
  const mints = await fetchMints(
    c,
    p.assets.map((a) => a.mint as Address),
  );
  const assets = p.assets.map((a) => ({
    mint: a.mint as Address,
    weightBps: a.weightBps,
    tokenProgram: (mints.get(a.mint as Address)?.programId ?? TOKEN_PROGRAM) as Address,
  }));
  // Keyed by address: symbols are not unique, the index address is.
  const uri = `${webUrl}/api/meta/${await indexPda(account, indexId)}`;
  const build = () =>
    createIndexIx({
      creator: user,
      indexId,
      name: p.name,
      symbol: p.symbol,
      uri,
      assets,
      fees: p.fees,
      strategy: { ...p.strategy, mode: MODE[p.strategy.mode] },
      parent: (p.parent ?? null) as Address | null,
      followsParent: p.followsParent ?? false,
    });
  const deposit = p.depositUsdc ?? 0;
  if (step === 0) {
    const { ix, index } = await build();
    if (fits(account, [ix])) {
      return {
        step,
        label: "Create the index",
        txs: await toTxs(account, [[ix]]),
        next: deposit > 0 ? 10 : null,
        state: { indexId: indexId.toString(), index },
        summary: `Create ${p.name} (${p.symbol})`,
      };
    }
    const addrs = await indexAltAddresses(index, await shareMintPda(index), assets);
    const { alt, batches } = await createAltIxs(c, user, addrs);
    return {
      step,
      label: "Prepare a lookup table (large index)",
      txs: await toTxs(account, batches, null, 200_000),
      next: 1,
      state: { indexId: indexId.toString(), index, alt, altSize: addrs.length },
      summary: `Create ${p.name} (${p.symbol})`,
    };
  }
  if (step === 1) {
    const alt = state.alt as Address;
    await waitAltActive(c, alt, Number(state.altSize ?? 1));
    const { ix, index } = await build();
    return {
      step,
      label: "Create the index",
      txs: await toTxs(account, [[ix]], alt),
      next: deposit > 0 ? 10 : null,
      state: { ...state, index },
    };
  }
  // Deposit: join steps 10/11 on the new index.
  const index = state.index as Address;
  if (state.alt && step === 10)
    await saveLookupTable(index, state.alt as string).catch(() => false);
  const r = await joinStep(
    account,
    index,
    deposit,
    step - 10,
    (state.join as Record<string, unknown>) ?? {},
  );
  return {
    ...r,
    step,
    next: r.next === null ? null : 10 + r.next,
    state: { ...state, join: r.state },
  };
}

// ---------------- manage (assistant mode, D048) ----------------
// Single-step intents. Each re-checks on chain that the connected wallet is the one the
// program accepts, so a wrong wallet fails here (403) before anything is signed.

export type ManageKind =
  | "propose_update"
  | "apply_update"
  | "cancel_update"
  | "set_paused"
  | "set_managers"
  | "claim_fees";

export const MANAGE_KINDS: readonly string[] = [
  "propose_update",
  "apply_update",
  "cancel_update",
  "set_paused",
  "set_managers",
  "claim_fees",
];

interface ProposeStored {
  assets: { mint: string; symbol?: string; weightBps: number }[] | null;
  fees: { mgmtFeeBps: number; entryFeeBps: number; exitFeeBps: number } | null;
  strategy: {
    mode: "Manual" | "Threshold" | "Periodic";
    driftThresholdBps: number;
    periodSecs: number;
    maxSlippageBps: number;
    cooldownSecs: number;
    allowKeeper: boolean;
  } | null;
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function requireCreator(st: IndexState, account: Address, action: string): void {
  if (st.creator !== account)
    throw new UserError(
      `Only the creator of ${st.symbol} (${short(st.creator)}) can ${action}. Connect that wallet.`,
      403,
    );
}

function requireIdle(st: IndexState): void {
  if (st.rebalanceTicket.__option === "Some")
    throw new UserError(`${st.symbol} is rebalancing. Try again in a minute.`, 409);
}

/** Target list with every funded asset the proposal leaves out kept at 0% (vault rule). */
function withKept(
  st: IndexState,
  assets: { mint: string; weightBps: number }[],
): { mint: Address; weightBps: number }[] {
  const out = assets.map((a) => ({ mint: a.mint as Address, weightBps: a.weightBps }));
  for (const e of st.assets)
    if (e.balance > 0n && !out.some((x) => x.mint === e.mint))
      out.push({ mint: e.mint, weightBps: 0 });
  if (out.length > 10)
    throw new UserError(
      "Too many assets: some left-out assets still hold a balance and must stay at 0% until sold. Ask the agent for a smaller update.",
    );
  return out;
}

export async function manageStep(
  account: Address,
  kind: ManageKind,
  params: Record<string, unknown>,
): Promise<StepResult> {
  const c = chain();
  const user = createNoopSigner(account);
  const index = params.index as Address;
  const st = await fetchIndex(c, index);
  requireIdle(st);
  const one = async (label: string, ixs: Instruction[], summary: string, cu = 400_000) => ({
    step: 0,
    label,
    txs: await toTxs(account, [ixs], await lookupTableOf(index), cu),
    next: null,
    // `index` lets /sign link to the index once done.
    state: { index },
    summary,
  });
  switch (kind) {
    case "propose_update": {
      requireCreator(st, account, "propose updates");
      const p = params as unknown as ProposeStored;
      if (!p.assets && !p.fees && !p.strategy) throw new UserError("Nothing to update");
      if (p.assets && st.followsParent)
        throw new UserError(`${st.symbol} follows its parent: its weights cannot be changed.`);
      const ix = await proposeUpdateIx(user, index, st, {
        assets: p.assets ? withKept(st, p.assets) : undefined,
        fees: p.fees ?? undefined,
        strategy: p.strategy ? { ...p.strategy, mode: MODE[p.strategy.mode] } : undefined,
      });
      return one("Propose the update", [ix], `Propose an update to ${st.symbol}`);
    }
    case "apply_update": {
      if (st.pendingUpdate.__option !== "Some")
        throw new UserError(`${st.symbol} has no pending update (applied or cancelled).`, 409);
      const eta = Number(st.pendingUpdate.value.eta);
      const now = Number(await chainClock(c));
      if (eta > now)
        throw new UserError(
          `Too early: this update can be applied after ${new Date(eta * 1000).toLocaleString("en-US")} (chain time).`,
          409,
        );
      return one(
        "Apply the update",
        [await applyUpdateIx(user, index, st)],
        `Apply the pending update to ${st.symbol}`,
        600_000,
      );
    }
    case "cancel_update": {
      requireCreator(st, account, "cancel updates");
      if (st.pendingUpdate.__option !== "Some")
        throw new UserError(`${st.symbol} has no pending update to cancel.`, 409);
      return one(
        "Cancel the update",
        [await cancelUpdateIx(user, index)],
        `Cancel the pending update to ${st.symbol}`,
      );
    }
    case "set_paused": {
      const paused = params.paused === true;
      requireCreator(st, account, paused ? "pause it" : "resume it");
      if (st.paused === paused)
        throw new UserError(`${st.symbol} is already ${paused ? "paused" : "active"}.`, 409);
      return one(
        paused ? "Pause the index" : "Resume the index",
        [await setPausedIx(user, index, paused)],
        `${paused ? "Pause" : "Resume"} ${st.symbol}`,
      );
    }
    case "set_managers": {
      requireCreator(st, account, "set managers");
      const managers = (params.managers as string[] | undefined) ?? [];
      if (managers.length > 3) throw new UserError("At most 3 managers");
      if (managers.some((m) => !isAddress(m)) || new Set(managers).size !== managers.length)
        throw new UserError("Managers must be distinct wallet addresses");
      return one(
        "Set managers",
        [await setManagersIx(user, index, managers as Address[])],
        `Set the managers of ${st.symbol}`,
      );
    }
    case "claim_fees": {
      const royalty = params.kind === "royalty";
      let parent: Address | undefined;
      if (royalty) {
        const p = parentOf(st);
        if (!p) throw new UserError(`${st.symbol} is not a clone: it owes no royalty.`);
        const ps = await fetchIndex(c, p);
        if (ps.creator !== account)
          throw new UserError(
            `Only the parent's creator (${short(ps.creator)}) can claim this royalty. Connect that wallet.`,
            403,
          );
        parent = p;
      } else requireCreator(st, account, "claim its creator fees");
      const owed = royalty ? st.owedParentShares : st.owedCreatorShares;
      if (owed === 0n && st.fees.mgmtFeeBps === 0)
        throw new UserError(`Nothing to claim on ${st.symbol} yet.`, 409);
      return one(
        royalty ? "Claim royalty" : "Claim fees",
        await claimFeesIxs(
          user,
          index,
          st,
          royalty ? vault.FeeKind.Parent : vault.FeeKind.Creator,
          parent,
        ),
        `${royalty ? "Claim the royalty" : "Claim creator fees"} on ${st.symbol}`,
      );
    }
  }
}
