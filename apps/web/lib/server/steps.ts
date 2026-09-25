import "server-only";
/**
 * Server-built transaction steps for sign intents (MCP → /sign) and Blinks.
 * Each step returns unsigned v0 transactions (fee payer = the user's wallet);
 * later steps read chain state produced by earlier ones (swap outputs, ALT).
 */
import { getIndex } from "@repo/db";
import {
  assertFreshPrices,
  ata,
  buildUnsignedTxBase64,
  createAltIxs,
  createAtaIx,
  createIndexIx,
  fetchIndex,
  fetchMints,
  fetchTokenBalances,
  fitInitialAmounts,
  fits,
  indexAltAddresses,
  indexPda,
  joinIxs,
  loadAlt,
  market,
  math,
  pack,
  planZapIn,
  planZapOut,
  redeemIxs,
  shareMintPda,
  swapIx,
  TOKEN_PROGRAM,
  valueIndex,
  vault,
  waitAltActive,
} from "@repo/sdk";
import { type Address, createNoopSigner, type Instruction } from "@solana/kit";
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
