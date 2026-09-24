/**
 * High-level instruction builders with the final remaining_accounts layouts (A05).
 * Every builder returns plain Kit instructions; sending is done by `tx.ts`.
 */

import {
  type AccountMeta,
  AccountRole,
  type Address,
  type Instruction,
  none,
  some,
  type TransactionSigner,
} from "@solana/kit";
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token";
import type { IndexState } from "./accounts";
import * as vault from "./generated/index-vault";
import * as market from "./generated/mock-market";
import {
  ATA_PROGRAM,
  ata,
  configPda,
  feedPda,
  INSTRUCTIONS_SYSVAR,
  indexPda,
  ipoPda,
  MOCK_MARKET,
  marketPda,
  SYSTEM_PROGRAM,
  shareMintPda,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "./pda";

const ro = (address: Address): AccountMeta => ({ address, role: AccountRole.READONLY });
const rw = (address: Address): AccountMeta => ({ address, role: AccountRole.WRITABLE });

export function withAccounts<T extends Instruction>(ix: T, extra: AccountMeta[]): Instruction {
  return { ...ix, accounts: [...(ix.accounts ?? []), ...extra] };
}

export async function createAtaIx(
  payer: TransactionSigner,
  owner: Address,
  mint: Address,
  tokenProgram: Address,
): Promise<Instruction> {
  return getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner, mint, tokenProgram });
}

// ---------------- market ----------------

/** Create the user's USDC ATA (idempotent) + mint USDC from the faucet. */
export async function faucetIxs(
  user: TransactionSigner,
  usdcMint: Address,
  amount: bigint,
): Promise<Instruction[]> {
  return [
    await createAtaIx(user, user.address, usdcMint, TOKEN_PROGRAM),
    await market.getFaucetInstructionAsync({
      user,
      market: await marketPda(),
      usdcMint,
      userAta: await ata(user.address, usdcMint, TOKEN_PROGRAM),
      tokenProgram: TOKEN_PROGRAM,
      amount,
    }),
  ];
}

export interface MintRef {
  mint: Address;
  tokenProgram: Address;
}

export async function swapIx(
  user: TransactionSigner,
  from: MintRef,
  to: MintRef,
  amountIn: bigint,
  minOut: bigint,
  owner: Address = user.address,
): Promise<Instruction> {
  return market.getSwapInstructionAsync({
    user,
    market: await marketPda(),
    mintIn: from.mint,
    mintOut: to.mint,
    feedIn: await feedPda(from.mint),
    feedOut: await feedPda(to.mint),
    userAtaIn: await ata(owner, from.mint, from.tokenProgram),
    userAtaOut: await ata(owner, to.mint, to.tokenProgram),
    tokenProgramIn: from.tokenProgram,
    tokenProgramOut: to.tokenProgram,
    amountIn,
    minOut,
  });
}

// ---------------- index_vault ----------------

export interface CreateIndexParams {
  creator: TransactionSigner;
  indexId: bigint;
  name: string;
  symbol: string;
  uri: string;
  assets: { mint: Address; tokenProgram: Address; weightBps: number }[];
  fees: vault.FeeConfigArgs;
  strategy: vault.StrategyArgs;
  parent?: Address | null;
  followsParent?: boolean;
}

export async function createIndexIx(
  p: CreateIndexParams,
): Promise<{ index: Address; shareMint: Address; ix: Instruction }> {
  const index = await indexPda(p.creator.address, p.indexId);
  const shareMint = await shareMintPda(index);
  const extra: AccountMeta[] = [];
  for (const a of p.assets) {
    extra.push(ro(a.mint), ro(await feedPda(a.mint)), rw(await ata(index, a.mint, a.tokenProgram)));
  }
  const ix = await vault.getCreateIndexInstructionAsync({
    creator: p.creator,
    config: await configPda(),
    index,
    shareMint,
    indexShareAta: await ata(index, shareMint, TOKEN_PROGRAM),
    parentIndex: p.parent ?? undefined,
    tokenProgram: TOKEN_PROGRAM,
    token2022Program: TOKEN_2022_PROGRAM,
    associatedTokenProgram: ATA_PROGRAM,
    systemProgram: SYSTEM_PROGRAM,
    indexId: p.indexId,
    name: p.name,
    symbol: p.symbol,
    uri: p.uri,
    assets: p.assets.map((a) => ({ mint: a.mint, targetWeightBps: a.weightBps })),
    fees: p.fees,
    strategy: p.strategy,
    followsParent: p.followsParent ?? false,
  });
  return { index, shareMint, ix: withAccounts(ix, extra) };
}

/** Share ATA (idempotent) + join. `initial` adds the oracle segment. */
export async function joinIxs(
  user: TransactionSigner,
  index: Address,
  state: IndexState,
  maxAmounts: bigint[],
  minShares: bigint,
  initial: boolean,
): Promise<Instruction[]> {
  const extra: AccountMeta[] = [];
  for (const a of state.assets) {
    extra.push(
      ro(a.mint),
      rw(await ata(index, a.mint, a.tokenProgram)),
      rw(await ata(user.address, a.mint, a.tokenProgram)),
    );
  }
  if (initial) for (const a of state.assets) extra.push(ro(a.oracle));
  const ix = await vault.getJoinInstructionAsync({
    user,
    config: await configPda(),
    index,
    shareMint: state.shareMint,
    userShareAta: await ata(user.address, state.shareMint, TOKEN_PROGRAM),
    indexShareAta: await ata(index, state.shareMint, TOKEN_PROGRAM),
    tokenProgram: TOKEN_PROGRAM,
    token2022Program: TOKEN_2022_PROGRAM,
    maxAmounts,
    minShares,
  });
  return [
    await createAtaIx(user, user.address, state.shareMint, TOKEN_PROGRAM),
    withAccounts(ix, extra),
  ];
}

/** User asset ATAs (idempotent) + redeem. */
export async function redeemIxs(
  user: TransactionSigner,
  index: Address,
  state: IndexState,
  shares: bigint,
  minAmounts: bigint[],
): Promise<{ atas: Instruction[]; redeem: Instruction }> {
  const extra: AccountMeta[] = [];
  const atas: Instruction[] = [];
  for (const a of state.assets) {
    extra.push(
      ro(a.mint),
      rw(await ata(index, a.mint, a.tokenProgram)),
      rw(await ata(user.address, a.mint, a.tokenProgram)),
    );
    atas.push(await createAtaIx(user, user.address, a.mint, a.tokenProgram));
  }
  const ix = await vault.getRedeemInstructionAsync({
    user,
    config: await configPda(),
    index,
    shareMint: state.shareMint,
    userShareAta: await ata(user.address, state.shareMint, TOKEN_PROGRAM),
    tokenProgram: TOKEN_PROGRAM,
    token2022Program: TOKEN_2022_PROGRAM,
    shares,
    minAmounts,
  });
  return { atas, redeem: withAccounts(ix, extra) };
}

export async function accrueFeesIx(index: Address, state: IndexState): Promise<Instruction> {
  return vault.getAccrueFeesInstructionAsync({
    config: await configPda(),
    index,
    shareMint: state.shareMint,
  });
}

export async function claimFeesIxs(
  claimer: TransactionSigner,
  index: Address,
  state: IndexState,
  kind: vault.FeeKind,
  parent?: Address,
): Promise<Instruction[]> {
  return [
    await createAtaIx(claimer, claimer.address, state.shareMint, TOKEN_PROGRAM),
    await vault.getClaimFeesInstructionAsync({
      claimer,
      config: await configPda(),
      index,
      shareMint: state.shareMint,
      recipientShareAta: await ata(claimer.address, state.shareMint, TOKEN_PROGRAM),
      parentIndex: parent,
      tokenProgram: TOKEN_PROGRAM,
      kind,
    }),
  ];
}

export interface UpdateParams {
  assets?: { mint: Address; weightBps: number }[];
  fees?: vault.FeeConfigArgs;
  strategy?: vault.StrategyArgs;
}

export async function proposeUpdateIx(
  creator: TransactionSigner,
  index: Address,
  state: IndexState,
  u: UpdateParams,
): Promise<Instruction> {
  const extra: AccountMeta[] = [];
  for (const a of u.assets ?? []) extra.push(ro(a.mint), ro(await feedPda(a.mint)));
  const ix = await vault.getProposeUpdateInstructionAsync({
    creator,
    config: await configPda(),
    index,
    shareMint: state.shareMint,
    assets: u.assets
      ? some(u.assets.map((a) => ({ mint: a.mint, targetWeightBps: a.weightBps })))
      : none(),
    fees: u.fees ? some(u.fees) : none(),
    strategy: u.strategy ? some(u.strategy) : none(),
  });
  return withAccounts(ix, extra);
}

/** Resulting asset list of a pending update (mirrors vault::replace_assets). */
export function pendingResult(state: IndexState): vault.AssetEntry[] | null {
  if (state.pendingUpdate.__option !== "Some") return null;
  const next = state.pendingUpdate.value.assets;
  if (next.__option !== "Some") return null;
  return next.value
    .map((n) => ({ ...n, balance: state.assets.find((c) => c.mint === n.mint)?.balance ?? 0n }))
    .filter((n) => n.balance > 0n || n.targetWeightBps > 0);
}

export async function applyUpdateIx(
  payer: TransactionSigner,
  index: Address,
  state: IndexState,
): Promise<Instruction> {
  const extra: AccountMeta[] = [];
  for (const a of pendingResult(state) ?? [])
    extra.push(ro(a.mint), rw(await ata(index, a.mint, a.tokenProgram)));
  const ix = await vault.getApplyUpdateInstructionAsync({
    payer,
    config: await configPda(),
    index,
    shareMint: state.shareMint,
    tokenProgram: TOKEN_PROGRAM,
    token2022Program: TOKEN_2022_PROGRAM,
    associatedTokenProgram: ATA_PROGRAM,
    systemProgram: SYSTEM_PROGRAM,
  });
  return withAccounts(ix, extra);
}

export async function cancelUpdateIx(
  creator: TransactionSigner,
  index: Address,
): Promise<Instruction> {
  return vault.getCancelUpdateInstruction({ creator, index });
}

export async function setManagersIx(
  creator: TransactionSigner,
  index: Address,
  managers: Address[],
): Promise<Instruction> {
  return vault.getSetManagersInstruction({ creator, index, managers });
}

export async function setPausedIx(
  creator: TransactionSigner,
  index: Address,
  paused: boolean,
): Promise<Instruction> {
  return vault.getSetPausedInstruction({ creator, index, paused });
}

export async function pairsFor(state: IndexState): Promise<AccountMeta[]> {
  return state.assets.flatMap((a) => [ro(a.mint), ro(a.oracle)]);
}

export async function beginRebalanceIx(
  executor: TransactionSigner,
  index: Address,
  state: IndexState,
  assetOut: number,
  amountOut: bigint,
  assetIn: number,
  minAmountIn: bigint,
): Promise<Instruction> {
  const o = state.assets[assetOut] as vault.AssetEntry;
  const i = state.assets[assetIn] as vault.AssetEntry;
  const ix = await vault.getBeginRebalanceInstructionAsync({
    executor,
    config: await configPda(),
    index,
    vaultOutAta: await ata(index, o.mint, o.tokenProgram),
    executorOutAta: await ata(executor.address, o.mint, o.tokenProgram),
    vaultInAta: await ata(index, i.mint, i.tokenProgram),
    instructions: INSTRUCTIONS_SYSVAR,
    tokenProgram: TOKEN_PROGRAM,
    token2022Program: TOKEN_2022_PROGRAM,
    assetOut,
    amountOut,
    assetIn,
    minAmountIn,
  });
  return withAccounts(ix, await pairsFor(state));
}

export async function endRebalanceIx(
  executor: TransactionSigner,
  index: Address,
  state: IndexState,
  assetIn: number,
): Promise<Instruction> {
  const i = state.assets[assetIn] as vault.AssetEntry;
  const ix = await vault.getEndRebalanceInstructionAsync({
    executor,
    config: await configPda(),
    index,
    vaultInAta: await ata(index, i.mint, i.tokenProgram),
  });
  return withAccounts(ix, await pairsFor(state));
}

export async function migrateIpoIx(
  payer: TransactionSigner,
  index: Address,
  state: IndexState,
  assetIdx: number,
  newMint: Address,
  newTokenProgram: Address = TOKEN_2022_PROGRAM,
): Promise<Instruction> {
  const old = state.assets[assetIdx] as vault.AssetEntry;
  return vault.getMigrateIpoAssetInstructionAsync({
    payer,
    config: await configPda(),
    index,
    marketProgram: MOCK_MARKET,
    market: await marketPda(),
    ipo: await ipoPda(old.mint),
    oldMint: old.mint,
    newMint,
    newFeed: await feedPda(newMint),
    vaultOldAta: await ata(index, old.mint, old.tokenProgram),
    vaultNewAta: await ata(index, newMint, newTokenProgram),
    tokenProgramOld: old.tokenProgram,
    tokenProgramNew: newTokenProgram,
    associatedTokenProgram: ATA_PROGRAM,
    systemProgram: SYSTEM_PROGRAM,
    assetIdx,
  });
}

/** Resulting asset list of a follow sync (mirrors follow.rs). */
export function syncResult(state: IndexState, parent: IndexState): vault.AssetEntry[] {
  const next: vault.AssetEntry[] = parent.assets.map((p) => ({
    ...p,
    balance: state.assets.find((l) => l.mint === p.mint)?.balance ?? 0n,
  }));
  for (const l of state.assets) {
    if (l.balance > 0n && !next.some((n) => n.mint === l.mint))
      next.push({ ...l, targetWeightBps: 0 });
  }
  return next;
}

export async function syncTargetsIx(
  payer: TransactionSigner,
  index: Address,
  state: IndexState,
  parent: Address,
  parentState: IndexState,
): Promise<Instruction> {
  const extra: AccountMeta[] = [];
  for (const a of syncResult(state, parentState))
    extra.push(ro(a.mint), rw(await ata(index, a.mint, a.tokenProgram)));
  const ix = await vault.getSyncTargetsFromParentInstructionAsync({
    payer,
    config: await configPda(),
    index,
    parentIndex: parent,
    tokenProgram: TOKEN_PROGRAM,
    token2022Program: TOKEN_2022_PROGRAM,
    associatedTokenProgram: ATA_PROGRAM,
    systemProgram: SYSTEM_PROGRAM,
  });
  return withAccounts(ix, extra);
}
