/**
 * One transaction pipeline for every signer (browser wallet, worker keypair,
 * agent): v0 message (D011) → optional ALT compression → CU limit →
 * sign → send → confirm (PLAN §7.2, A05).
 */

import {
  type Address,
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  type Base64EncodedWireTransaction,
  type Blockhash,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  estimateAndSetResourceLimitsFactory,
  estimateResourceLimitsFactory,
  fetchAddressesForLookupTables,
  fillTransactionMessageProvisoryResourceLimits,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  getTransactionEncoder,
  type Instruction,
  pipe,
  prependTransactionMessageInstructions,
  type Signature,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { TxFailedError } from "./errors";
import type { SolanaCtx } from "./rpc";

export interface TxOptions {
  /** Address lookup tables to compress the message with. */
  lookupTables?: Address[];
  /** Fixed CU limit; when omitted the limit is estimated by simulation. */
  computeUnitLimit?: number;
  /** Optional priority fee (devnet). */
  microLamportsPerCu?: bigint;
  /** Human label used in errors / logs. */
  label?: string;
}

export const MAX_TX_BYTES = 1232;
const MAX_CU = 1_400_000;

/** Build a v0 message with fee payer, blockhash, instructions, CU limit, optional ALT. */
export async function buildMessage(
  ctx: SolanaCtx,
  payer: TransactionSigner,
  ixs: Instruction[],
  opts: TxOptions = {},
) {
  const { value: blockhash } = await ctx.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const pre: Instruction[] = [];
  if (opts.microLamportsPerCu)
    pre.push(getSetComputeUnitPriceInstruction({ microLamports: opts.microLamportsPerCu }));
  if (opts.computeUnitLimit)
    pre.push(getSetComputeUnitLimitInstruction({ units: opts.computeUnitLimit }));
  const base = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
    (m) => (pre.length ? prependTransactionMessageInstructions(pre, m) : m),
  );
  const alt = opts.lookupTables?.length
    ? await fetchAddressesForLookupTables(opts.lookupTables, ctx.rpc)
    : null;
  if (opts.computeUnitLimit) {
    return alt ? compressTransactionMessageUsingAddressLookupTables(base, alt) : base;
  }
  const provisory = fillTransactionMessageProvisoryResourceLimits(base);
  const compressed = alt
    ? compressTransactionMessageUsingAddressLookupTables(provisory, alt)
    : provisory;
  const exact = estimateResourceLimitsFactory({ rpc: ctx.rpc });
  // Simulation reports exact usage; execution can cost a little more (account
  // state changes between simulate and land, esp. on devnet). Add headroom.
  const withMargin: typeof exact = async (...args) => {
    const e = await exact(...args);
    return {
      ...e,
      computeUnitLimit: Math.min(MAX_CU, Math.ceil(e.computeUnitLimit * 1.15) + 5_000),
      ...(e.loadedAccountsDataSizeLimit
        ? { loadedAccountsDataSizeLimit: Math.ceil(e.loadedAccountsDataSizeLimit * 1.1) + 8_192 }
        : {}),
    };
  };
  const estimate = estimateAndSetResourceLimitsFactory(withMargin);
  return estimate(compressed);
}

/**
 * Sign with all embedded signers, send (with preflight) and confirm by polling
 * signature status over HTTP. No websocket: rate-limited RPC plans (devnet)
 * cap concurrent subscriptions. Returns the signature.
 */
export async function sendTx(
  ctx: SolanaCtx,
  payer: TransactionSigner,
  ixs: Instruction[],
  opts: TxOptions = {},
): Promise<Signature> {
  const message = await buildMessage(ctx, payer, ixs, opts);
  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  const sig = getSignatureFromTransaction(signed);
  await ctx.rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();
  await confirmSignature(ctx, sig, signed.lifetimeConstraint.lastValidBlockHeight);
  return sig;
}

/** Poll until confirmed; throws on an on-chain error or when the blockhash expires. */
export async function confirmSignature(
  ctx: SolanaCtx,
  sig: Signature,
  lastValidBlockHeight: bigint,
): Promise<void> {
  const pause = ctx.cluster === "localnet" ? 200 : 800;
  for (let i = 0; ; i++) {
    const {
      value: [st],
    } = await ctx.rpc.getSignatureStatuses([sig]).send();
    if (st?.err) {
      const err = JSON.stringify(st.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
      throw new TxFailedError(
        `Transaction ${sig} failed on chain: ${err}`,
        sig,
        await fetchLogs(ctx, sig),
      );
    }
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return;
    if (i % 5 === 4) {
      const h = await ctx.rpc.getBlockHeight({ commitment: "confirmed" }).send();
      if (h > lastValidBlockHeight)
        throw new Error(`Transaction ${sig} was not confirmed in time (block height exceeded)`);
    }
    await new Promise((r) => setTimeout(r, pause));
  }
}

/**
 * Program logs of a landed transaction (they carry the failing program id and
 * the Anchor error name). Best effort: empty when the RPC has not indexed it yet.
 */
async function fetchLogs(ctx: SolanaCtx, sig: Signature): Promise<string[]> {
  for (let i = 0; i < 5; i++) {
    try {
      const tx = await ctx.rpc
        .getTransaction(sig, {
          commitment: "confirmed",
          encoding: "json",
          maxSupportedTransactionVersion: 0,
        })
        .send();
      const logs = tx?.meta?.logMessages;
      if (logs) return [...logs];
    } catch {
      // not available yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return [];
}

/** Send several transactions in order (fresh blockhash each; PLAN §7.2). */
export async function sendTxs(
  ctx: SolanaCtx,
  payer: TransactionSigner,
  batches: Instruction[][],
  opts: TxOptions = {},
  onProgress?: (done: number, total: number, sig: Signature) => void,
): Promise<Signature[]> {
  const sigs: Signature[] = [];
  for (const [i, ixs] of batches.entries()) {
    const sig = await sendTx(ctx, payer, ixs, opts);
    sigs.push(sig);
    onProgress?.(i + 1, batches.length, sig);
  }
  return sigs;
}

/**
 * Unsigned v0 transaction (base64) for an external signer (Blinks, intents).
 * The fee payer is set by address only.
 */
export async function buildUnsignedTxBase64(
  ctx: SolanaCtx,
  feePayer: Address,
  ixs: Instruction[],
  opts: { lookupTables?: Address[]; computeUnitLimit?: number } = {},
): Promise<{
  tx: Base64EncodedWireTransaction;
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
}> {
  const { value: bh } = await ctx.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const pre: Instruction[] = [
    getSetComputeUnitLimitInstruction({ units: opts.computeUnitLimit ?? 400_000 }),
  ];
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions([...pre, ...ixs], m),
  );
  const alt = opts.lookupTables?.length
    ? await fetchAddressesForLookupTables(opts.lookupTables, ctx.rpc)
    : null;
  const finalMsg = alt ? compressTransactionMessageUsingAddressLookupTables(msg, alt) : msg;
  const tx = compileTransaction(finalMsg);
  return {
    tx: getBase64EncodedWireTransaction(tx),
    blockhash: bh.blockhash,
    lastValidBlockHeight: bh.lastValidBlockHeight,
  };
}

/** Serialized size of a message (to decide on ALT / splitting). */
export async function measureTx(
  ctx: SolanaCtx,
  payer: TransactionSigner,
  ixs: Instruction[],
  opts: TxOptions = {},
): Promise<number> {
  const message = await buildMessage(ctx, payer, ixs, {
    ...opts,
    computeUnitLimit: opts.computeUnitLimit ?? 1_400_000,
  });
  const tx = compileTransaction(message);
  return getTransactionEncoder().getSizeFromValue(tx);
}
