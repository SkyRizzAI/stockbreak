/**
 * Indexer (A07): poll signatures of index_vault, decode events, store them
 * idempotently, then sync touched indexes and positions.
 */
import { getIndexerState, insertEvents, setIndexerState } from "@repo/db";
import {
  decodeVaultEvents,
  fetchAllIndexes,
  INDEX_VAULT,
  type IndexState,
  toJson,
} from "@repo/sdk";
import type { Address, Signature } from "@solana/kit";
import type { WorkerCtx } from "../ctx";
import { syncIndex, syncPosition } from "../sync";

const PROGRAM = "index_vault";

async function newSignatures(c: WorkerCtx, until: string | undefined) {
  const out: { signature: Signature; slot: bigint; err: unknown; blockTime: bigint | null }[] = [];
  let before: Signature | undefined;
  for (let page = 0; page < 50; page++) {
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

export async function indexerTick(c: WorkerCtx): Promise<number> {
  const state = await getIndexerState(c.db, PROGRAM);
  const sigs = await newSignatures(c, state?.lastSignature ?? undefined);
  if (!sigs.length) return 0;
  let stored = 0;
  const touched = new Map<string, IndexState | null>();
  for (const s of sigs) {
    if (s.err) continue;
    let tx = null;
    for (let i = 0; i < 5 && !tx; i++) {
      tx = await c.rpc
        .getTransaction(s.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
          encoding: "json",
        })
        .send();
      if (!tx) await Bun.sleep(300);
    }
    if (!tx?.meta || tx.meta.err) continue;
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
    stored += await insertEvents(c.db, rows);
    for (const r of rows) {
      if (!r.index) continue;
      if (!touched.has(r.index)) touched.set(r.index, await syncIndex(c, r.index));
      const st = touched.get(r.index);
      if (!st) continue;
      const d = r.data as Record<string, string>;
      if (r.type === "Joined" && r.wallet)
        await syncPosition(c, r.wallet, r.index, st, { joinedShares: BigInt(d.shares ?? "0") });
      if (r.type === "Redeemed" && r.wallet)
        await syncPosition(c, r.wallet, r.index, st, { burnedShares: BigInt(d.shares ?? "0") });
      if (r.type === "FeesClaimed" && r.wallet) await syncPosition(c, r.wallet, r.index, st);
    }
  }
  const last = sigs.at(-1);
  if (last) await setIndexerState(c.db, PROGRAM, last.signature, last.slot);
  if (stored) c.log("indexer", `${stored} events from ${sigs.length} txs`);
  return stored;
}

/** Safety net: upsert every on-chain index (catches anything the poller missed). */
export async function fullResync(c: WorkerCtx): Promise<number> {
  const all = await fetchAllIndexes(c);
  for (const { address } of all) await syncIndex(c, address as Address);
  return all.length;
}
