/**
 * Idempotent market + config bootstrap (PLAN §7.9), shared by `scripts/bootstrap.ts`
 * and SDK integration tests.
 */
import { ASSETS, type AssetDef, CLUSTER_PARAMS, type Cluster } from "@repo/config";
import {
  AccountRole,
  type Address,
  address,
  type Instruction,
  lamports,
  type TransactionSigner,
} from "@solana/kit";
import * as vault from "./generated/index-vault";
import * as market from "./generated/mock-market";
import {
  configPda,
  feedPda,
  MOCK_MARKET,
  marketPda,
  mockMintPda,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "./pda";
import type { SolanaCtx } from "./rpc";
import { sendTx } from "./tx";

export async function accountExists(ctx: SolanaCtx, addr: string): Promise<boolean> {
  const { value } = await ctx.rpc.getAccountInfo(address(addr), { encoding: "base64" }).send();
  return value !== null;
}

export async function solBalance(ctx: SolanaCtx, addr: string): Promise<number> {
  const { value } = await ctx.rpc.getBalance(address(addr)).send();
  return Number(value) / 1e9;
}

/** Localnet only: airdrop up to `minSol`. */
export async function ensureSol(ctx: SolanaCtx, addr: string, minSol: number): Promise<void> {
  if (ctx.cluster !== "localnet") return;
  const bal = await solBalance(ctx, addr);
  if (bal >= minSol) return;
  await ctx.rpc
    .requestAirdrop(address(addr), lamports(BigInt(Math.ceil((minSol - bal + 1) * 1e9))))
    .send();
  for (let i = 0; i < 60; i++) {
    if ((await solBalance(ctx, addr)) >= minSol) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`airdrop to ${addr} did not land`);
}

export const toOraclePrice = (usd: number): bigint => BigInt(Math.round(usd * 1e8));

const kindOf = (a: AssetDef) =>
  a.kind === "Stable"
    ? market.AssetKind.Stable
    : a.kind === "PreIpo"
      ? market.AssetKind.PreIpo
      : market.AssetKind.Stock;

/** set_prices for many feeds (chunks of 12). `usd` by symbol. */
export async function setPrices(
  ctx: SolanaCtx,
  admin: TransactionSigner,
  feeds: { feed: Address; usd: number }[],
): Promise<void> {
  for (let i = 0; i < feeds.length; i += 12) {
    const chunk = feeds.slice(i, i + 12);
    const ix = await market.getSetPricesInstructionAsync({
      authority: admin,
      prices: chunk.map((f) => ({ price: toOraclePrice(f.usd), expo: -8, conf: 0n })),
    });
    const withFeeds: Instruction = {
      ...ix,
      accounts: [
        ...ix.accounts,
        ...chunk.map((f) => ({ address: f.feed, role: AccountRole.WRITABLE })),
      ],
    };
    await sendTx(ctx, admin, [withFeeds]);
  }
}

/** Create a mock mint + feed if missing. */
export async function ensureAsset(
  ctx: SolanaCtx,
  admin: TransactionSigner,
  a: AssetDef,
): Promise<{ mint: Address; feed: Address }> {
  const marketAddr = await marketPda();
  const mint = await mockMintPda(a.symbol);
  if (a.symbol !== "USDC" && !(await accountExists(ctx, mint))) {
    await sendTx(ctx, admin, [
      await market.getCreateMockMintInstructionAsync({
        authority: admin,
        market: marketAddr,
        mint,
        tokenProgram: a.token2022 ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM,
        systemProgram: SYSTEM_PROGRAM,
        symbol: a.symbol,
        decimals: a.decimals,
        token2022: a.token2022,
        scaledUi: a.scaledUi,
      }),
    ]);
  }
  const feed = await feedPda(mint);
  if (!(await accountExists(ctx, feed))) {
    await sendTx(ctx, admin, [
      await market.getCreateFeedInstructionAsync({
        authority: admin,
        market: marketAddr,
        mint,
        feed,
        kind: kindOf(a),
      }),
    ]);
  }
  return { mint, feed };
}

export interface BootstrapResult {
  market: Address;
  config: Address;
  mints: Record<string, Address>;
  feeds: Record<string, Address>;
}

export async function bootstrapMarket(
  ctx: SolanaCtx,
  admin: TransactionSigner,
  opts: {
    cluster?: Cluster;
    fund?: string[];
    prices?: Record<string, number>;
    log?: (m: string) => void;
  } = {},
): Promise<BootstrapResult> {
  const params = CLUSTER_PARAMS[opts.cluster ?? ctx.cluster];
  const log = opts.log ?? (() => {});
  await ensureSol(ctx, admin.address, 50);
  for (const f of opts.fund ?? []) await ensureSol(ctx, f, 10);

  const marketAddr = await marketPda();
  if (!(await accountExists(ctx, marketAddr))) {
    await sendTx(ctx, admin, [
      await market.getInitMarketInstructionAsync({
        authority: admin,
        usdcMint: await mockMintPda("USDC"),
        tokenProgram: TOKEN_PROGRAM,
        spreadBps: params.spreadBps,
        faucetMax: params.faucetMaxUsdc,
        oracleMaxAgeSecs: params.oracleMaxAgeSecs,
      }),
    ]);
    log(`market ${marketAddr}`);
  }
  const mints: Record<string, Address> = {};
  const feeds: Record<string, Address> = {};
  for (const a of ASSETS.filter((x) => x.bootstrap)) {
    const r = await ensureAsset(ctx, admin, a);
    mints[a.symbol] = r.mint;
    feeds[a.symbol] = r.feed;
  }
  await setPrices(
    ctx,
    admin,
    Object.entries(feeds).map(([symbol, feed]) => ({
      feed,
      usd: opts.prices?.[symbol] ?? ASSETS.find((a) => a.symbol === symbol)?.fixturePrice ?? 1,
    })),
  );
  const config = await configPda();
  if (!(await accountExists(ctx, config))) {
    await sendTx(ctx, admin, [
      await vault.getInitConfigInstructionAsync({
        admin,
        config,
        params: {
          platformTreasury: admin.address,
          platformFeeBps: params.platformFeeBps,
          cloneRoyaltyBps: params.cloneRoyaltyBps,
          marketProgram: MOCK_MARKET,
          timelockSecs: params.timelockSecs,
          oracleMaxAgeSecs: params.oracleMaxAgeSecs,
        },
      }),
    ]);
    log(`config ${config}`);
  }
  return { market: marketAddr, config, mints, feeds };
}
