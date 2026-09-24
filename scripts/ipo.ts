/**
 * bun run ipo -- --asset <PRE-IPO SYMBOL> [--ratio 3:2] [--cluster devnet]
 * Simulated IPO (PLAN §7.9): create the listed stock + feed, register the
 * conversion, migrate every holding index, then sync followers.
 */
import { assetBySymbol, findAsset } from "@repo/config";
import { readDeployment, writeDeployment } from "@repo/config/node";
import { migrateAllHolders, registerIpoEvent } from "@repo/sdk";
import { argValue, chainCtx } from "./lib/chain";
import { log } from "./lib/proc";

const S = "ipo";
const sym = argValue("asset");
const pre = sym ? findAsset(sym) : undefined;
if (pre?.kind !== "PreIpo") {
  console.error(
    "usage: bun run ipo -- --asset <SPACEX-pre|OPENAI-pre|ANTHRP-pre|ANDURL-pre> [--ratio 1:1]",
  );
  process.exit(1);
}
const [num, den] = (argValue("ratio") ?? "1:1").split(":").map((x) => BigInt(x));
const c = await chainCtx();
const ev = await registerIpoEvent(c, c.admin, pre.symbol, {
  ratioNum: num ?? 1n,
  ratioDen: den ?? 1n,
});
log(S, `${ev.preSymbol} → ${ev.newSymbol} (${ev.ratioNum}:${ev.ratioDen}) new mint ${ev.newMint}`);
const res = await migrateAllHolders(c, c.admin, ev);
log(S, `migrated ${res.migrated.length} index(es), synced ${res.synced.length} follower(s)`);

const d = readDeployment(c.cluster);
if (d) {
  const target = assetBySymbol(ev.newSymbol);
  d.mints[target.symbol] = ev.newMint;
  const { feedPda } = await import("@repo/sdk");
  d.feeds[target.symbol] = await feedPda(ev.newMint);
  d.ipos[ev.preSymbol] = {
    newSymbol: ev.newSymbol,
    newMint: ev.newMint,
    ratioNum: ev.ratioNum.toString(),
    ratioDen: ev.ratioDen.toString(),
    at: new Date().toISOString(),
  };
  writeDeployment(d);
}
process.exit(0);
