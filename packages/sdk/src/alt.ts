/** Address Lookup Table per index (A05): created by the creator (or keeper). */

import {
  type Address,
  type AddressesByLookupTableAddress,
  fetchAddressesForLookupTables,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  fetchAddressLookupTable,
  findAddressLookupTablePda,
  getCreateLookupTableInstruction,
  getExtendLookupTableInstruction,
} from "@solana-program/address-lookup-table";
import {
  ATA_PROGRAM,
  ata,
  COMPUTE_BUDGET_PROGRAM,
  configPda,
  feedPda,
  INDEX_VAULT,
  INSTRUCTIONS_SYSVAR,
  MOCK_MARKET,
  marketPda,
  SYSTEM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "./pda";
import type { SolanaCtx } from "./rpc";

/** Every index-wide address a join/redeem/rebalance tx touches. */
export async function indexAltAddresses(
  index: Address,
  shareMint: Address,
  assets: { mint: Address; tokenProgram: Address }[],
): Promise<Address[]> {
  const base: Address[] = [
    INDEX_VAULT,
    MOCK_MARKET,
    TOKEN_PROGRAM,
    TOKEN_2022_PROGRAM,
    ATA_PROGRAM,
    SYSTEM_PROGRAM,
    COMPUTE_BUDGET_PROGRAM,
    INSTRUCTIONS_SYSVAR,
    await configPda(),
    await marketPda(),
    index,
    shareMint,
    await ata(index, shareMint, TOKEN_PROGRAM),
  ];
  for (const a of assets)
    base.push(a.mint, await feedPda(a.mint), await ata(index, a.mint, a.tokenProgram));
  return [...new Set(base)];
}

/** Instructions to create + fill a new ALT (split so each tx stays small). */
export async function createAltIxs(
  ctx: SolanaCtx,
  authority: TransactionSigner,
  addresses: Address[],
): Promise<{ alt: Address; batches: Instruction[][] }> {
  const recentSlot = await ctx.rpc.getSlot({ commitment: "finalized" }).send();
  const [alt, bump] = await findAddressLookupTablePda({ authority: authority.address, recentSlot });
  const create = getCreateLookupTableInstruction({
    address: alt,
    authority,
    payer: authority,
    recentSlot,
    bump,
  });
  const batches: Instruction[][] = [];
  const chunk = 20;
  for (let i = 0; i < addresses.length; i += chunk) {
    const ext = getExtendLookupTableInstruction({
      address: alt,
      authority,
      payer: authority,
      addresses: addresses.slice(i, i + chunk),
    });
    batches.push(i === 0 ? [create, ext] : [ext]);
  }
  return { alt, batches };
}

/** Wait until the ALT is active (one slot after its last extend). */
export async function waitAltActive(
  ctx: SolanaCtx,
  alt: Address,
  expected: number,
  timeoutMs = 20_000,
): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const acc = await fetchAddressLookupTable(ctx.rpc, alt, { commitment: "confirmed" });
      const slot = await ctx.rpc.getSlot({ commitment: "confirmed" }).send();
      if (acc.data.addresses.length >= expected && slot > acc.data.lastExtendedSlot) return;
    } catch {
      // not visible yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`lookup table ${alt} not active`);
}

export async function loadAlt(
  ctx: SolanaCtx,
  alt: Address | null | undefined,
): Promise<AddressesByLookupTableAddress | undefined> {
  if (!alt) return undefined;
  try {
    return await fetchAddressesForLookupTables([alt], ctx.rpc);
  } catch {
    return undefined;
  }
}
