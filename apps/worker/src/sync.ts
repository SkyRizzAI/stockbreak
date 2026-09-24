/** Chain → DB sync for indexes and positions. */
import {
  deletePosition,
  getIndex,
  getPosition,
  getUser,
  upsertIndex,
  upsertPosition,
} from "@repo/db";
import {
  ata,
  fetchMaybeIndex,
  fetchTokenBalances,
  type IndexState,
  managersOf,
  parentOf,
  TOKEN_PROGRAM,
  toJson,
  valueIndex,
} from "@repo/sdk";
import type { Address } from "@solana/kit";
import type { WorkerCtx } from "./ctx";

export function assetsJson(c: WorkerCtx, st: IndexState) {
  return st.assets.map((a) => ({
    mint: a.mint,
    symbol: c.symbolOf(a.mint) ?? a.mint.slice(0, 4),
    tokenProgram: a.tokenProgram,
    oracle: a.oracle,
    targetWeightBps: a.targetWeightBps,
    kind: ["Stock", "PreIpo", "Stable"][a.kind] ?? "Stock",
    decimals: a.decimals,
    balance: a.balance.toString(),
  }));
}

export async function syncIndex(c: WorkerCtx, address: string): Promise<IndexState | null> {
  const st = await fetchMaybeIndex(c, address as Address);
  if (!st) return null;
  const creatorUser = await getUser(c.db, st.creator);
  await upsertIndex(c.db, {
    pubkey: address,
    creator: st.creator,
    indexId: st.indexId,
    shareMint: st.shareMint,
    name: st.name,
    symbol: st.symbol,
    uri: st.uri,
    parent: parentOf(st),
    followsParent: st.followsParent,
    assets: assetsJson(c, st),
    fees: toJson(st.fees),
    strategy: {
      ...(toJson(st.strategy) as Record<string, unknown>),
      mode: ["Manual", "Threshold", "Periodic"][st.strategy.mode],
    },
    managers: managersOf(st),
    pendingUpdate: toJson(st.pendingUpdate) as object | null,
    paused: st.paused,
    isAgentIndex: creatorUser?.isAgent ?? false,
    createdAt: new Date(Number(st.createdAt) * 1000),
  });
  return st;
}

/**
 * Refresh one wallet's position from its share balance. `joinedShares` /
 * `burnedShares` adjust cost basis at the current share price.
 */
export async function syncPosition(
  c: WorkerCtx,
  wallet: string,
  index: string,
  st: IndexState,
  delta: { joinedShares?: bigint; burnedShares?: bigint } = {},
): Promise<void> {
  if (wallet === index) return;
  const shareAta = await ata(wallet as Address, st.shareMint, TOKEN_PROGRAM);
  const shares = (await fetchTokenBalances(c, [shareAta])).get(shareAta) ?? 0n;
  const prev = await getPosition(c.db, wallet, index);
  if (shares === 0n) {
    if (prev) await deletePosition(c.db, wallet, index);
    return;
  }
  let cost = prev?.costBasisMicroUsd ?? 0n;
  if (delta.joinedShares || delta.burnedShares || !prev) {
    const val = await valueIndex(c, st);
    if (delta.joinedShares) cost += (delta.joinedShares * val.sharePrice) / 1_000_000n;
    if (delta.burnedShares && prev && prev.shares > 0n)
      cost -= (cost * delta.burnedShares) / (prev.shares || 1n);
    if (!prev && !delta.joinedShares) cost = (shares * val.sharePrice) / 1_000_000n;
  }
  await upsertPosition(c.db, {
    wallet,
    index,
    shares,
    costBasisMicroUsd: cost < 0n ? 0n : cost,
    firstJoinedAt: prev?.firstJoinedAt ?? new Date(),
  });
}

export async function indexKnown(c: WorkerCtx, address: string): Promise<boolean> {
  return !!(await getIndex(c.db, address));
}
