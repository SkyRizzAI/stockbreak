/** Chain → DB sync for indexes and positions. */
import {
  getIndex,
  getIndexerState,
  getPosition,
  getUser,
  reconcilePosition,
  upsertIndex,
} from "@repo/db";
import {
  ata,
  fetchMaybeIndex,
  fetchTokenBalances,
  INDEX_VAULT,
  type IndexState,
  managersOf,
  parentOf,
  TOKEN_PROGRAM,
  toJson,
  valueIndex,
} from "@repo/sdk";
import type { Address, Signature } from "@solana/kit";
import type { WorkerCtx } from "./ctx";

export const PROGRAM = "index_vault";

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

/** Per-tick cache of live share prices (micro-USD) per index. */
export class SharePrices {
  private readonly cache = new Map<string, bigint>();
  constructor(private readonly c: WorkerCtx) {}
  async of(index: string, st: IndexState): Promise<bigint> {
    const hit = this.cache.get(index);
    if (hit !== undefined) return hit;
    const p = (await valueIndex(this.c, st)).sharePrice;
    this.cache.set(index, p);
    return p;
  }
}

/**
 * True when index_vault has no transactions newer than the indexer cursor,
 * i.e. every vault-driven share change is already reflected in `positions`.
 */
export async function vaultQuiet(
  c: WorkerCtx,
  cursor: string | null | undefined,
): Promise<boolean> {
  if (!cursor) return false;
  const res = await c.rpc
    .getSignaturesForAddress(INDEX_VAULT, {
      limit: 1,
      until: cursor as Signature,
      commitment: "confirmed",
    })
    .send();
  return res.length === 0;
}

/**
 * Reconcile stored positions with on-chain share balances (catches plain SPL
 * transfers, which the indexer does not see). Only runs while the vault is
 * quiet before and after reading balances, so an unindexed join/redeem is never
 * mistaken for a transfer. Returns the number of positions changed, or null
 * when skipped.
 */
export async function reconcilePositions(
  c: WorkerCtx,
  pairs: { wallet: string; index: string; st: IndexState }[],
  prices: SharePrices,
): Promise<number | null> {
  const todo = pairs.filter((p) => p.wallet !== p.index);
  if (!todo.length) return 0;
  const cursor = (await getIndexerState(c.db, PROGRAM))?.lastSignature;
  if (!(await vaultQuiet(c, cursor))) return null;
  const atas = await Promise.all(
    todo.map((p) => ata(p.wallet as Address, p.st.shareMint, TOKEN_PROGRAM)),
  );
  const balances = new Map<Address, bigint>();
  for (let i = 0; i < atas.length; i += 100) {
    const got = await fetchTokenBalances(c, atas.slice(i, i + 100));
    for (const [k, v] of got) balances.set(k, v);
  }
  if (!(await vaultQuiet(c, cursor))) return null;
  let changed = 0;
  for (const [i, p] of todo.entries()) {
    const a = atas[i];
    if (!a) continue;
    const chain = balances.get(a) ?? 0n;
    const prev = await getPosition(c.db, p.wallet, p.index);
    if ((prev?.shares ?? 0n) === chain) continue;
    const price = chain > (prev?.shares ?? 0n) ? await prices.of(p.index, p.st) : 0n;
    if (await reconcilePosition(c.db, p.wallet, p.index, chain, price)) changed++;
  }
  return changed;
}

export async function indexKnown(c: WorkerCtx, address: string): Promise<boolean> {
  return !!(await getIndex(c.db, address));
}
