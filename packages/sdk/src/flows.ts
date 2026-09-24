/** Multi-transaction user flows shared by web, MCP, worker and scripts. */
import type { Address, Signature, TransactionSigner } from "@solana/kit";
import { fetchMints } from "./accounts";
import { createAltIxs, indexAltAddresses, waitAltActive } from "./alt";
import { type CreateIndexParams, createIndexIx } from "./instructions";
import { fits } from "./pack";
import { indexPda, shareMintPda } from "./pda";
import type { SolanaCtx } from "./rpc";
import { sendTx } from "./tx";

export interface FlowProgress {
  step: string;
  done: number;
  total: number;
  signature?: Signature;
}

export type CreateIndexInput = Omit<CreateIndexParams, "assets"> & {
  assets: { mint: Address; weightBps: number }[];
};

/** Unused index id for a creator (time-based, collision-checked). */
export async function nextIndexId(ctx: SolanaCtx, creator: Address): Promise<bigint> {
  let id = BigInt(Date.now());
  for (let i = 0; i < 5; i++, id++) {
    const addr = await indexPda(creator, id);
    const { value } = await ctx.rpc.getAccountInfo(addr, { encoding: "base64" }).send();
    if (!value) return id;
  }
  return id;
}

/**
 * Create an index. When the instruction does not fit in one transaction
 * (≥ 5 assets, A05) a lookup table is created first and returned.
 */
export async function createIndexFlow(
  ctx: SolanaCtx,
  input: CreateIndexInput,
  onProgress?: (p: FlowProgress) => void,
): Promise<{
  index: Address;
  shareMint: Address;
  lookupTable: Address | null;
  signatures: Signature[];
}> {
  const mints = await fetchMints(
    ctx,
    input.assets.map((a) => a.mint),
  );
  const assets = input.assets.map((a) => {
    const m = mints.get(a.mint);
    if (!m) throw new Error(`Unknown mint ${a.mint}`);
    return { ...a, tokenProgram: m.programId };
  });
  const { index, shareMint, ix } = await createIndexIx({ ...input, assets });
  const signatures: Signature[] = [];
  let lookupTable: Address | null = null;
  if (!fits(input.creator.address, [ix])) {
    const addrs = await indexAltAddresses(index, await shareMintPda(index), assets);
    const { alt, batches } = await createAltIxs(ctx, input.creator, addrs);
    const total = batches.length + 1;
    for (const [i, b] of batches.entries()) {
      signatures.push(await sendTx(ctx, input.creator, b));
      onProgress?.({ step: "lookup-table", done: i + 1, total, signature: signatures.at(-1) });
    }
    await waitAltActive(ctx, alt, addrs.length);
    lookupTable = alt;
    signatures.push(await sendTx(ctx, input.creator, [ix], { lookupTables: [alt] }));
    onProgress?.({ step: "create", done: total, total, signature: signatures.at(-1) });
  } else {
    signatures.push(await sendTx(ctx, input.creator, [ix]));
    onProgress?.({ step: "create", done: 1, total: 1, signature: signatures.at(-1) });
  }
  return { index, shareMint, lookupTable, signatures };
}

/** Lookup table for an existing index (keeper / creator on demand). */
export async function createIndexAlt(
  ctx: SolanaCtx,
  payer: TransactionSigner,
  index: Address,
  shareMint: Address,
  assets: { mint: Address; tokenProgram: Address }[],
): Promise<Address> {
  const addrs = await indexAltAddresses(index, shareMint, assets);
  const { alt, batches } = await createAltIxs(ctx, payer, addrs);
  for (const b of batches) await sendTx(ctx, payer, b);
  await waitAltActive(ctx, alt, addrs.length);
  return alt;
}
