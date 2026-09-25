/** IPO event helpers (PLAN §6.5, §7.9 `bun run ipo`). */
import { type AssetDef, assetBySymbol } from "@repo/config";
import type { Address, TransactionSigner } from "@solana/kit";
import { fetchAllIndexes, fetchFeeds, fetchIndex, type IndexState, priceUsd } from "./accounts";
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
  const ipo = await ipoPda(oldMint);
  const registered = await accountExists(ctx, ipo);
  const { mint: newMint, feed } = await ensureAsset(ctx, admin, target);
  let ratioNum = opts.ratioNum ?? 1n;
  let ratioDen = opts.ratioDen ?? 1n;
  if (registered) {
    // Re-run: keep the on-chain ratio and the live price (no reset, no NAV jump).
    const ev = await market.fetchIpoConversion(ctx.rpc, ipo).catch(() => null);
    if (ev) {
      ratioNum = ev.data.ratioNum;
      ratioDen = ev.data.ratioDen;
    }
  } else {
    // Value continuity: holders convert raw amounts at num/den, so the listed stock starts at
    // the pre-IPO price × den/num (decimal-adjusted) instead of a fixed default.
    const oldFeed = await feedPda(oldMint);
    const f = (await fetchFeeds(ctx, [oldFeed])).get(oldFeed);
    const preUsd = f && f.price > 0n ? priceUsd(f) : pre.fixturePrice;
    const continuous =
      ((preUsd * Number(ratioDen)) / Number(ratioNum)) * 10 ** (target.decimals - pre.decimals);
    await setPrices(ctx, admin, [{ feed, usd: opts.priceUsd ?? continuous }]);
  }
  if (!registered) {
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

export interface MigrationFailure {
  index: Address;
  error: string;
}

/**
 * migrate_ipo_asset for every index holding `oldMint`, then sync followers of migrated parents.
 * Followers migrate before their parents (a follow sync must never add the new stock to a
 * follower that still holds the pre-IPO token), each index is re-read right before its
 * instruction is built, and one failure never stops the rest.
 */
export async function migrateAllHolders(
  ctx: SolanaCtx,
  payer: TransactionSigner,
  ev: IpoEvent,
): Promise<{
  migrated: MigrationResult[];
  synced: MigrationResult[];
  failed: MigrationFailure[];
}> {
  const all = await fetchAllIndexes(ctx);
  const holders = all.filter(({ data }) => data.assets.some((a) => a.mint === ev.oldMint));
  const depth = (addr: Address): number => {
    let d = 0;
    let cur = all.find((x) => x.address === addr)?.data;
    while (cur && cur.parent.__option === "Some" && d < 16) {
      const parent: Address = cur.parent.value;
      cur = all.find((x) => x.address === parent)?.data;
      d++;
    }
    return d;
  };
  holders.sort((a, b) => depth(b.address) - depth(a.address));
  const migrated: MigrationResult[] = [];
  const failed: MigrationFailure[] = [];
  for (const { address } of holders) {
    try {
      const data = await fetchIndex(ctx, address);
      const idx = data.assets.findIndex((a) => a.mint === ev.oldMint);
      if (idx < 0) continue;
      const sig = await sendTx(ctx, payer, [
        await migrateIpoIx(payer, address, data, idx, ev.newMint, TOKEN_2022_PROGRAM),
      ]);
      migrated.push({ index: address, signature: sig });
    } catch (e) {
      failed.push({
        index: address,
        error: e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e),
      });
    }
  }
  const synced: MigrationResult[] = [];
  const fresh = await fetchAllIndexes(ctx);
  const byAddr = new Map(fresh.map((x) => [x.address, x.data] as const));
  for (const { address, data } of fresh) {
    if (!data.followsParent || data.parent.__option !== "Some") continue;
    const parent = data.parent.value;
    if (!migrated.some((m) => m.index === parent)) continue;
    try {
      const pState = byAddr.get(parent) as IndexState;
      const sig = await sendTx(ctx, payer, [
        await syncTargetsIx(payer, address, data, parent, pState),
      ]);
      synced.push({ index: address, signature: sig });
    } catch (e) {
      failed.push({
        index: address,
        error: e instanceof Error ? (e.message.split("\n")[0] ?? "") : String(e),
      });
    }
  }
  return { migrated, synced, failed };
}

export const isPreIpo = (a: vault.AssetEntry) => a.kind === vault.AssetKind.PreIpo;
