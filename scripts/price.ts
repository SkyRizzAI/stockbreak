/**
 * bun run price -- --asset <SYMBOL> --pct <+/-N> [--cluster localnet|devnet]
 * Deterministic price change for demos & drift tests. Applied on-chain now and
 * remembered as a shock factor so the price feeder keeps it (PLAN §7.9).
 */
import { findAsset } from "@repo/config";
import { readDeployment, readShocks, writeShocks } from "@repo/config/node";
import { market, sendTx } from "@repo/sdk";
import { AccountRole, type Address, type Instruction } from "@solana/kit";
import { argValue, chainCtx } from "./lib/chain";

const symbolArg = argValue("asset");
const pct = Number(argValue("pct"));
if (!symbolArg || !Number.isFinite(pct)) {
  console.error("usage: bun run price -- --asset <SYMBOL> --pct <+/-N>");
  process.exit(1);
}
const asset = findAsset(symbolArg);
if (!asset) throw new Error(`Unknown asset ${symbolArg}`);

const c = await chainCtx();
const d = readDeployment(c.cluster);
const feed = d?.feeds[asset.symbol];
if (!feed) throw new Error(`No feed for ${asset.symbol} on ${c.cluster} — run bootstrap first`);

const acc = await market.fetchOracleFeed(c.rpc, feed as Address);
const factor = 1 + pct / 100;
const next = BigInt(Math.max(1, Math.round(Number(acc.data.price) * factor)));
const ix = await market.getSetPricesInstructionAsync({
  authority: c.admin,
  prices: [{ price: next, expo: acc.data.expo, conf: 0n }],
});
const withFeed: Instruction = {
  ...ix,
  accounts: [...ix.accounts, { address: feed as Address, role: AccountRole.WRITABLE }],
};
const sig = await sendTx(c, c.admin, [withFeed]);

const shocks = readShocks(c.cluster);
shocks[asset.symbol] = (shocks[asset.symbol] ?? 1) * factor;
writeShocks(c.cluster, shocks);
const usd = (p: bigint) => (Number(p) * 10 ** acc.data.expo).toFixed(2);
console.log(
  `[price] ${asset.symbol} ${usd(acc.data.price)} → ${usd(next)} USD (${pct > 0 ? "+" : ""}${pct}%) ${sig}`,
);
process.exit(0);
