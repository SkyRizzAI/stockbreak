import "server-only";
/**
 * On-demand chain → DB sync for one index. The worker indexes new indexes a few
 * seconds late; flows that run right after create (description, lookup table,
 * posts, Blinks) read the chain and upsert the row themselves instead of failing.
 * Mirrors apps/worker/src/sync.ts `syncIndex`.
 */
import { getIndex, getUser, type IndexRow, setLookupTable, upsertIndex } from "@repo/db";
import {
  fetchMaybeIndex,
  indexAltAddresses,
  loadAlt,
  managersOf,
  parentOf,
  toJson,
} from "@repo/sdk";
import type { Address } from "@solana/kit";
import { chain, db, symbolOf } from "./ctx";

export async function ensureIndexRow(pubkey: string): Promise<IndexRow | undefined> {
  const d = db();
  const row = await getIndex(d, pubkey);
  if (row) return row;
  const st = await fetchMaybeIndex(chain(), pubkey as Address);
  if (!st) return undefined;
  const creatorUser = await getUser(d, st.creator);
  await upsertIndex(d, {
    pubkey,
    creator: st.creator,
    indexId: st.indexId,
    shareMint: st.shareMint,
    name: st.name,
    symbol: st.symbol,
    uri: st.uri,
    parent: parentOf(st),
    followsParent: st.followsParent,
    assets: st.assets.map((a) => ({
      mint: a.mint,
      symbol: symbolOf(a.mint),
      tokenProgram: a.tokenProgram,
      oracle: a.oracle,
      targetWeightBps: a.targetWeightBps,
      kind: ["Stock", "PreIpo", "Stable"][a.kind] ?? "Stock",
      decimals: a.decimals,
      balance: a.balance.toString(),
    })),
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
  return getIndex(d, pubkey);
}

/**
 * Record an index's address lookup table after checking on chain that it holds
 * every address a join/redeem needs (a bogus table would make those txs too large).
 * Keeps an existing valid table. Returns false when the table is not usable.
 */
export async function saveLookupTable(pubkey: string, alt: string): Promise<boolean> {
  const c = chain();
  const st = await fetchMaybeIndex(c, pubkey as Address);
  if (!st) return false;
  const need = await indexAltAddresses(pubkey as Address, st.shareMint, st.assets);
  const valid = async (table: string | null | undefined) => {
    const got = await loadAlt(c, table as Address | null | undefined);
    const list = table ? new Set(got?.[table as Address] ?? []) : new Set();
    return list.size > 0 && need.every((a) => list.has(a));
  };
  if (!(await valid(alt))) return false;
  const row = await ensureIndexRow(pubkey);
  if (!row) return false;
  if (row.lookupTable && row.lookupTable !== alt && (await valid(row.lookupTable))) return true;
  await setLookupTable(db(), pubkey, alt);
  return true;
}
