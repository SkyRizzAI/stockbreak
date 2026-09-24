/** IPO event helpers (PLAN §6.5, §7.9 `bun run ipo`). */
import { type AssetDef, assetBySymbol } from "@repo/config";
import type { Address, TransactionSigner } from "@solana/kit";
import { fetchAllIndexes, type IndexState } from "./accounts";
import { accountExists, ensureAsset, setPrices } from "./bootstrap";
import * as vault from "./generated/index-vault";
import * as market from "./generated/mock-market";
import { migrateIpoIx, syncTargetsIx } from "./instructions";
import { feedPda, ipoPda, marketPda, mockMintPda, TOKEN_2022_PROGRAM } from "./pda";
import type { SolanaCtx } from "./rpc";
import { sendTx } from "./tx";

export interface IpoEvent {
  preSymbol: string;
  newSymbol: string;
  oldMint: Address;
  newMint: Address;
  ratioNum: bigint;
  ratioDen: bigint;
}

/** Create the listed stock (+feed, price) and register the conversion. Idempotent. */
export async function registerIpoEvent(
  ctx: SolanaCtx,
  admin: TransactionSigner,
  preSymbol: string,
  opts: { ratioNum?: bigint; ratioDen?: bigint; priceUsd?: number } = {},
): Promise<IpoEvent> {
  const pre = assetBySymbol(preSymbol);
  if (pre.kind !== "PreIpo" || !pre.ipoTarget)
    throw new Error(`${preSymbol} is not a pre-IPO asset`);
  const target: AssetDef = assetBySymbol(pre.ipoTarget);
  const oldMint = await mockMintPda(pre.symbol);
  const { mint: newMint, feed } = await ensureAsset(ctx, admin, target);
  await setPrices(ctx, admin, [{ feed, usd: opts.priceUsd ?? target.fixturePrice }]);
  const ratioNum = opts.ratioNum ?? 1n;
  const ratioDen = opts.ratioDen ?? 1n;
  const ipo = await ipoPda(oldMint);
  if (!(await accountExists(ctx, ipo))) {
    await sendTx(ctx, admin, [
      await market.getRegisterIpoInstructionAsync({
        authority: admin,
        market: await marketPda(),
        oldMint,
        newMint,
        newFeed: await feedPda(newMint),
        ipo,
        ratioNum,
        ratioDen,
      }),
    ]);
  }
  return { preSymbol, newSymbol: target.symbol, oldMint, newMint, ratioNum, ratioDen };
}

export interface MigrationResult {
  index: Address;
  signature: string;
}

/** migrate_ipo_asset for every index holding `oldMint`, then sync followers of migrated parents. */
export async function migrateAllHolders(
  ctx: SolanaCtx,
  payer: TransactionSigner,
  ev: IpoEvent,
): Promise<{ migrated: MigrationResult[]; synced: MigrationResult[] }> {
  const all = await fetchAllIndexes(ctx);
  const migrated: MigrationResult[] = [];
  for (const { address, data } of all) {
    const idx = data.assets.findIndex((a) => a.mint === ev.oldMint);
    if (idx < 0) continue;
    const sig = await sendTx(ctx, payer, [
      await migrateIpoIx(payer, address, data, idx, ev.newMint, TOKEN_2022_PROGRAM),
    ]);
    migrated.push({ index: address, signature: sig });
  }
  const synced: MigrationResult[] = [];
  const fresh = await fetchAllIndexes(ctx);
  const byAddr = new Map(fresh.map((x) => [x.address, x.data] as const));
  for (const { address, data } of fresh) {
    if (!data.followsParent || data.parent.__option !== "Some") continue;
    const parent = data.parent.value;
    if (!migrated.some((m) => m.index === parent)) continue;
    const pState = byAddr.get(parent) as IndexState;
    const sig = await sendTx(ctx, payer, [
      await syncTargetsIx(payer, address, data, parent, pState),
    ]);
    synced.push({ index: address, signature: sig });
  }
  return { migrated, synced };
}

export const isPreIpo = (a: vault.AssetEntry) => a.kind === vault.AssetKind.PreIpo;
