/**
 * Indexer (A07): poll signatures of index_vault, decode events, store them
 * idempotently with their position deltas, then reconcile touched positions.
 */
import {
  allPositions,
  applyIndexedTx,
  getIndexerState,
  type PositionDelta,
  setIndexerState,
} from "@repo/db";
import {
  decodeVaultEvents,
  fetchAllIndexes,
  INDEX_VAULT,
  type IndexState,
  toJson,
} from "@repo/sdk";
import type { Address, Signature } from "@solana/kit";
import type { WorkerCtx } from "../ctx";
import { PROGRAM, reconcilePositions, SharePrices, syncIndex } from "../sync";

async function newSignatures(c: WorkerCtx, until: string | undefined) {
  const out: { signature: Signature; slot: bigint; err: unknown; blockTime: bigint | null }[] = [];
  let before: Signature | undefined;
  // Pages go newest → oldest; the batch must reach the cursor or it would leave a gap.
  for (let page = 0; ; page++) {
    if (page >= 500) throw new Error("indexer backlog exceeds 500k signatures; refusing to skip");
    const res = await c.rpc
      .getSignaturesForAddress(INDEX_VAULT, {
        limit: 1000,
        before,
        until: until as Signature | undefined,
        commitment: "confirmed",
      })
      .send();
    out.push(
      ...res.map((r) => ({
        signature: r.signature,
        slot: r.slot,
        err: r.err,
        blockTime: r.blockTime as bigint | null,
      })),
    );
    if (res.length < 1000) break;
    before = res.at(-1)?.signature;
  }
  return out.reverse(); // oldest first
}

function walletOf(name: string, data: Record<string, unknown>): string | null {
  const key = {
    Joined: "user",
    Redeemed: "user",
    IndexCreated: "creator",
    RebalanceExecuted: "executor",
    FeesClaimed: "recipient",
  }[name];
  const v = key ? data[key] : null;
  return typeof v === "string" ? v : null;
}

/** Consecutive ticks a signature could not be fetched; skipped only after many retries. */
const fetchFailures = new Map<string, number>();
const MAX_FETCH_TICKS = 60;

async function fetchTx(c: WorkerCtx, signature: Signature) {
  for (let i = 0; i < 5; i++) {
    const tx = await c.rpc
      .getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
        encoding: "json",
      })
      .send();
    if (tx) return tx;
    await Bun.sleep(300);
  }
  return null;
}

/** Position change carried by one decoded event (shares at event time). */
async function deltaOf(
  type: string,
  wallet: string | null,
  index: string,
  st: IndexState,
  data: Record<string, unknown>,
  ts: Date,
  prices: SharePrices,
): Promise<PositionDelta | null> {
  if (!wallet || wallet === index) return null;
  const n = (k: string) => {
    const v = data[k];
    return typeof v === "string" || typeof v === "number" || typeof v === "bigint" ? BigInt(v) : 0n;
  };
  const shares = n("shares");
  if (shares === 0n) return null;
  if (type === "Joined") {
    // The user paid for gross shares (net + entry fee) at the share price.
    const price = await prices.of(index, st);
    const gross = shares + n("feeShares");
    return { wallet, index, addShares: shares, addCostMicroUsd: (gross * price) / 1_000_000n, ts };
  }
  if (type === "Redeemed") return { wallet, index, burnShares: shares, ts };
  if (type === "FeesClaimed") {
    const price = await prices.of(index, st);
    return { wallet, index, addShares: shares, addCostMicroUsd: (shares * price) / 1_000_000n, ts };
  }
  return null;
}

/**
 * Process new vault transactions oldest → newest. Each transaction's events,
 * position deltas and the cursor are written atomically, so a crash or a
 * transaction that cannot be fetched yet never skips or double-applies work:
 * the tick stops there and the next tick resumes from the last stored one.
 */
export async function indexerTick(c: WorkerCtx): Promise<number> {
  const state = await getIndexerState(c.db, PROGRAM);
  const sigs = await newSignatures(c, state?.lastSignature ?? undefined);
  if (!sigs.length) return 0;
  let stored = 0;
  let processed = 0;
  let complete = true;
  const touched = new Map<string, IndexState | null>();
  const holders = new Map<string, { wallet: string; index: string }>();
  const prices = new SharePrices(c);
  const stateOf = async (index: string) => {
    if (!touched.has(index)) touched.set(index, await syncIndex(c, index));
    return touched.get(index) ?? null;
  };
  for (const s of sigs) {
    if (s.err) {
      await setIndexerState(c.db, PROGRAM, s.signature, s.slot);
      processed++;
      continue;
    }
    const tx = await fetchTx(c, s.signature);
    if (!tx) {
      const fails = (fetchFailures.get(s.signature) ?? 0) + 1;
      fetchFailures.set(s.signature, fails);
      if (fails < MAX_FETCH_TICKS) {
        c.log("indexer", `tx ${s.signature} not fetchable yet (${fails}); retrying next tick`);
        complete = false;
        break;
      }
      c.log("indexer", `SKIPPING tx ${s.signature}: unfetchable for ${fails} ticks`);
      fetchFailures.delete(s.signature);
      await setIndexerState(c.db, PROGRAM, s.signature, s.slot);
      continue;
    }
    fetchFailures.delete(s.signature);
    if (!tx.meta || tx.meta.err) {
      await setIndexerState(c.db, PROGRAM, s.signature, s.slot);
      processed++;
      continue;
    }
    const decoded = decodeVaultEvents(tx.meta.logMessages ?? []);
    const ts = new Date(
      Number(tx.blockTime ?? s.blockTime ?? BigInt(Math.floor(Date.now() / 1000))) * 1000,
    );
    const rows = decoded.map((e) => {
      const data = toJson(e.data) as Record<string, unknown>;
      return {
        signature: s.signature,
        ixIndex: e.ordinal,
        type: e.name,
        index: typeof data.index === "string" ? data.index : null,
        wallet: walletOf(e.name, data),
        slot: s.slot,
        data,
        ts,
      };
    });
    const deltas = new Map<number, PositionDelta>();
    for (const r of rows) {
      if (!r.index) continue;
      const st = await stateOf(r.index);
      if (!st) continue;
      const d = await deltaOf(r.type, r.wallet, r.index, st, r.data, ts, prices);
      if (!d) continue;
      deltas.set(r.ixIndex, d);
      holders.set(`${d.wallet}:${d.index}`, { wallet: d.wallet, index: d.index });
    }
    stored += await applyIndexedTx(c.db, {
      program: PROGRAM,
      signature: s.signature,
      slot: s.slot,
      events: rows,
      deltas,
    });
    processed++;
  }
  // Positions are derived from events; the chain balance is the final word
  // (transfers). Only reconcile once caught up, so no event is still pending.
  if (complete && holders.size) {
    const pairs: { wallet: string; index: string; st: IndexState }[] = [];
    for (const h of holders.values()) {
      const st = touched.get(h.index);
      if (st) pairs.push({ ...h, st });
    }
    await reconcilePositions(c, pairs, prices);
  }
  if (stored) c.log("indexer", `${stored} events from ${processed}/${sigs.length} txs`);
  return stored;
}

/**
 * Safety net: upsert every on-chain index (catches anything the poller missed)
 * and refresh known holders' shares from chain (share transfers are not indexed).
 */
export async function fullResync(c: WorkerCtx): Promise<number> {
  const all = await fetchAllIndexes(c);
  const byAddr = new Map<string, IndexState>();
  for (const { address, data } of all) {
    await syncIndex(c, address as Address);
    byAddr.set(address, data);
  }
  const pairs: { wallet: string; index: string; st: IndexState }[] = [];
  for (const p of await allPositions(c.db)) {
    const st = byAddr.get(p.index);
    if (st) pairs.push({ wallet: p.wallet, index: p.index, st });
  }
  const changed = await reconcilePositions(c, pairs, new SharePrices(c));
  if (changed) c.log("resync", `reconciled ${changed} positions with on-chain balances`);
  return all.length;
}
