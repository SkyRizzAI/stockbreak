/** Local transaction sizing and greedy packing (no RPC round-trips). */

import {
  type Address,
  type AddressesByLookupTableAddress,
  appendTransactionMessageInstructions,
  type Blockhash,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getTransactionEncoder,
  type Instruction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";
import { MAX_TX_BYTES } from "./tx";

const DUMMY_BLOCKHASH = {
  blockhash: "11111111111111111111111111111111" as Blockhash,
  lastValidBlockHeight: 0n,
};

/** Serialized size of a v0 tx (+ CU limit ix) signed by `signers` keys. */
export function txSize(
  feePayer: Address,
  ixs: Instruction[],
  alt?: AddressesByLookupTableAddress,
): number {
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(DUMMY_BLOCKHASH, m),
    (m) =>
      appendTransactionMessageInstructions(
        [getSetComputeUnitLimitInstruction({ units: 1_400_000 }), ...ixs],
        m,
      ),
  );
  const final = alt ? compressTransactionMessageUsingAddressLookupTables(msg, alt) : msg;
  try {
    return getTransactionEncoder().getSizeFromValue(compileTransaction(final));
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function fits(
  feePayer: Address,
  ixs: Instruction[],
  alt?: AddressesByLookupTableAddress,
): boolean {
  return txSize(feePayer, ixs, alt) <= MAX_TX_BYTES;
}

/**
 * Greedily pack instruction groups (a group is never split) into as few
 * transactions as possible.
 */
export function pack(
  feePayer: Address,
  groups: Instruction[][],
  alt?: AddressesByLookupTableAddress,
): Instruction[][] {
  const out: Instruction[][] = [];
  let cur: Instruction[] = [];
  for (const g of groups) {
    if (cur.length && fits(feePayer, [...cur, ...g], alt)) {
      cur = [...cur, ...g];
      continue;
    }
    if (cur.length) out.push(cur);
    cur = [...g];
  }
  if (cur.length) out.push(cur);
  return out;
}
