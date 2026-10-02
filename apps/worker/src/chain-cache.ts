/**
 * One shared view of every index per few seconds: a single getProgramAccounts plus two
 * batched reads (all mints, all feeds) instead of one scan per loop and two reads per
 * index. Snapshot, keeper, fees, follow and resync all run each minute, so this is most
 * of the worker's RPC budget (a free RPC plan runs out within days without it).
 */
import { fetchAllIndexes, type IndexState, type Valuation, valueIndexes } from "@repo/sdk";
import type { Address } from "@solana/kit";
import type { WorkerCtx } from "./ctx";

/** Short enough that keeper decisions use fresh state; the program re-checks anyway. */
const TTL_MS = 10_000;

type Indexes = { address: Address; data: IndexState }[];
interface View {
  at: number;
  indexes: Promise<Indexes>;
  values: Promise<Map<Address, Valuation>> | null;
}

const views = new WeakMap<WorkerCtx, View>();

function view(c: WorkerCtx): View {
  const v = views.get(c);
  if (v && Date.now() - v.at < TTL_MS) return v;
  const indexes = fetchAllIndexes(c);
  const next: View = { at: Date.now(), indexes, values: null };
  // A failed read must not be served to the next caller.
  indexes.catch(() => views.delete(c));
  views.set(c, next);
  return next;
}

/** Every on-chain index (cached for a few seconds). */
export function allIndexes(c: WorkerCtx): Promise<Indexes> {
  return view(c).indexes;
}

/** NAV, weights and drift of every index (cached with the same view). */
export function allValuations(c: WorkerCtx): Promise<Map<Address, Valuation>> {
  const v = view(c);
  if (!v.values) {
    v.values = v.indexes.then((list) => valueIndexes(c, list));
    v.values.catch(() => {
      if (views.get(c) === v) views.delete(c);
    });
  }
  return v.values;
}

/** Drop the cached view (after a transaction that changed index state). */
export function invalidateIndexes(c: WorkerCtx): void {
  views.delete(c);
}
