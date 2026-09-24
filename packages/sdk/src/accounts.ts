/** Fetch + decode on-chain state and compute valuation (NAV, weights, drift). */

import {
  type Address,
  type Base58EncodedBytes,
  fetchEncodedAccounts,
  getBase58Decoder,
  getBase64Encoder,
  isSome,
  unwrapOption,
} from "@solana/kit";
import { getMintDecoder, getTokenDecoder } from "@solana-program/token-2022";
import * as vault from "./generated/index-vault";
import * as market from "./generated/mock-market";
import * as math from "./math";
import { INDEX_VAULT } from "./pda";
import type { SolanaCtx } from "./rpc";

export type IndexState = vault.IndexAccount;
export type AssetEntry = vault.AssetEntry;

export interface MintInfo {
  address: Address;
  programId: Address;
  decimals: number;
  supply: bigint;
  /** Effective Scaled UI multiplier in fixed point (1e12 = 1.0). */
  multFp: bigint;
  multiplier: number;
  mintAuthority: Address | null;
}

export interface FeedInfo {
  address: Address;
  mint: Address;
  price: bigint;
  expo: number;
  conf: bigint;
  publishTime: bigint;
  kind: market.AssetKind;
}

const nowSecs = () => BigInt(Math.floor(Date.now() / 1000));

/** Decode a mint (Token or Token-2022) and its effective multiplier at `now`. */
export function decodeMint(
  address: Address,
  programId: Address,
  data: Uint8Array,
  now = nowSecs(),
): MintInfo {
  const mint = getMintDecoder().decode(data);
  let multiplier = 1;
  const exts = unwrapOption(mint.extensions) ?? [];
  for (const e of exts) {
    if (e.__kind === "ScaledUiAmountConfig") {
      multiplier = now >= e.newMultiplierEffectiveTimestamp ? e.newMultiplier : e.multiplier;
    }
  }
  return {
    address,
    programId,
    decimals: mint.decimals,
    supply: mint.supply,
    multiplier,
    multFp: math.multFpFromF64(multiplier) ?? math.MULT_FP,
    mintAuthority: unwrapOption(mint.mintAuthority),
  };
}

export async function fetchMints(
  ctx: SolanaCtx,
  mints: Address[],
): Promise<Map<Address, MintInfo>> {
  const out = new Map<Address, MintInfo>();
  if (!mints.length) return out;
  const accs = await fetchEncodedAccounts(ctx.rpc, mints);
  for (const a of accs) {
    if (!a.exists) continue;
    out.set(a.address, decodeMint(a.address, a.programAddress, a.data as Uint8Array));
  }
  return out;
}

export async function fetchFeeds(
  ctx: SolanaCtx,
  feeds: Address[],
): Promise<Map<Address, FeedInfo>> {
  const out = new Map<Address, FeedInfo>();
  if (!feeds.length) return out;
  const accs = await market.fetchAllMaybeOracleFeed(ctx.rpc, feeds);
  for (const a of accs) {
    if (!a.exists) continue;
    out.set(a.address, {
      address: a.address,
      mint: a.data.mint,
      price: a.data.price,
      expo: a.data.expo,
      conf: a.data.conf,
      publishTime: a.data.publishTime,
      kind: a.data.kind,
    });
  }
  return out;
}

/** Token account balances (missing accounts → 0n). */
export async function fetchTokenBalances(
  ctx: SolanaCtx,
  accounts: Address[],
): Promise<Map<Address, bigint>> {
  const out = new Map<Address, bigint>();
  if (!accounts.length) return out;
  const accs = await fetchEncodedAccounts(ctx.rpc, accounts);
  for (const a of accs) {
    out.set(a.address, a.exists ? getTokenDecoder().decode(a.data as Uint8Array).amount : 0n);
  }
  return out;
}

export async function fetchIndex(ctx: SolanaCtx, address: Address): Promise<IndexState> {
  const a = await vault.fetchIndexAccount(ctx.rpc, address);
  return a.data;
}

export async function fetchMaybeIndex(
  ctx: SolanaCtx,
  address: Address,
): Promise<IndexState | null> {
  const { value } = await ctx.rpc.getAccountInfo(address, { encoding: "base64" }).send();
  // Missing, or not an Index account of this program (e.g. a wallet address).
  if (!value || value.owner !== vault.INDEX_VAULT_PROGRAM_ADDRESS) return null;
  try {
    const a = await vault.fetchMaybeIndexAccount(ctx.rpc, address);
    return a.exists ? a.data : null;
  } catch {
    return null;
  }
}

/** All Index accounts of the program (discriminator filter). */
export async function fetchAllIndexes(
  ctx: SolanaCtx,
): Promise<{ address: Address; data: IndexState }[]> {
  const disc = getBase58Decoder().decode(vault.INDEX_ACCOUNT_DISCRIMINATOR) as Base58EncodedBytes;
  const res = await ctx.rpc
    .getProgramAccounts(INDEX_VAULT, {
      encoding: "base64",
      filters: [{ memcmp: { offset: 0n, bytes: disc, encoding: "base58" } }],
    })
    .send();
  const dec = vault.getIndexAccountDecoder();
  return res.map((r) => ({
    address: r.pubkey,
    data: dec.decode(getBase64Encoder().encode(r.account.data[0])),
  }));
}

export async function fetchConfig(ctx: SolanaCtx, config: Address): Promise<vault.GlobalConfig> {
  return (await vault.fetchGlobalConfig(ctx.rpc, config)).data;
}

export interface AssetValuation {
  entry: AssetEntry;
  mint: MintInfo;
  feed: FeedInfo;
  value: bigint;
  weightBps: number;
  targetBps: number;
  priceUsd: number;
}

export interface Valuation {
  assets: AssetValuation[];
  nav: bigint;
  supply: bigint;
  effectiveSupply: bigint;
  sharePrice: bigint;
  driftSum: number;
  driftMax: number;
}

export function priceUsd(f: { price: bigint; expo: number }): number {
  return Number(f.price) * 10 ** f.expo;
}

/** NAV / weights / drift exactly as the program computes them. */
export async function valueIndex(ctx: SolanaCtx, index: IndexState): Promise<Valuation> {
  const mints = await fetchMints(ctx, [...index.assets.map((a) => a.mint), index.shareMint]);
  const feeds = await fetchFeeds(
    ctx,
    index.assets.map((a) => a.oracle),
  );
  const values = index.assets.map((a) => {
    const m = mints.get(a.mint);
    const f = feeds.get(a.oracle);
    if (!m || !f) return 0n;
    return math.valueUsd(a.balance, a.decimals, m.multFp, { price: f.price, expo: f.expo }) ?? 0n;
  });
  const nav = values.reduce((x, y) => x + y, 0n);
  const supply = mints.get(index.shareMint)?.supply ?? 0n;
  const effectiveSupply =
    supply + index.owedCreatorShares + index.owedPlatformShares + index.owedParentShares;
  const [driftSum, driftMax] = math.drift(
    values,
    index.assets.map((a) => a.targetWeightBps),
  ) ?? [0, 0];
  return {
    assets: index.assets.map((entry, i) => {
      const mint = mints.get(entry.mint) as MintInfo;
      const feed = feeds.get(entry.oracle) as FeedInfo;
      return {
        entry,
        mint,
        feed,
        value: values[i] as bigint,
        weightBps: math.weightBps(values[i] as bigint, nav),
        targetBps: entry.targetWeightBps,
        priceUsd: feed ? priceUsd(feed) * (mint?.multiplier ?? 1) : 0,
      };
    }),
    nav,
    supply,
    effectiveSupply,
    sharePrice: math.sharePrice(nav, effectiveSupply),
    driftSum,
    driftMax,
  };
}

export function managersOf(index: IndexState): Address[] {
  return index.managers.filter((m) => m !== "11111111111111111111111111111111");
}

export function parentOf(index: IndexState): Address | null {
  return isSome(index.parent) ? index.parent.value : null;
}
