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
// Record the listed stock right away: if a migration fails below, the worker still prices it.
const d = readDeployment(c.cluster);
const target = assetBySymbol(ev.newSymbol);
const record = () => {
  if (!d) return;
  d.ipos[ev.preSymbol] = {
    newSymbol: ev.newSymbol,
    newMint: ev.newMint,
    ratioNum: ev.ratioNum.toString(),
    ratioDen: ev.ratioDen.toString(),
    at: d.ipos[ev.preSymbol]?.at ?? new Date().toISOString(),
  };
  writeDeployment(d);
};
if (d) {
  const { feedPda } = await import("@repo/sdk");
  d.mints[target.symbol] = ev.newMint;
  d.feeds[target.symbol] = await feedPda(ev.newMint);
  // The worker's follow loop reads this to hold followers until their own migration.
  record();
}
const res = await migrateAllHolders(c, c.admin, ev);
log(S, `migrated ${res.migrated.length} index(es), synced ${res.synced.length} follower(s)`);
for (const f of res.failed) log(S, `FAILED ${f.index}: ${f.error}`);
if (res.failed.length) {
  log(S, `${res.failed.length} index(es) failed; re-run the same command to retry them`);
  process.exit(1);
}
process.exit(0);
