/**
 * P7 gate against a running localnet stack (`bun run dev` + `bun run seed`):
 * all tables filled, snapshots grow, a +30% shock triggers a keeper
 * rebalance within two keeper intervals, and `bun run ipo` migrates every holder.
 */

import { readDeployment } from "@repo/config/node";
import { countSnapshots, countTable, eventsOfType, getDb } from "@repo/db";
import { fetchAllIndexes } from "@repo/sdk";
import { chainCtx } from "./lib/chain";
import { log, run } from "./lib/proc";

const S = "gate-worker";
const db = getDb();
const c = await chainCtx("localnet");
const fail = (m: string): never => {
  console.error(`[${S}] FAIL: ${m}`);
  process.exit(1);
};
const wait = async (label: string, secs: number, ok: () => Promise<boolean>) => {
  for (let i = 0; i < secs; i++) {
    if (await ok()) return log(S, `ok: ${label}`);
    await Bun.sleep(1000);
  }
  fail(`${label} (timeout ${secs}s)`);
};

const tables = ["users", "indexes", "positions", "prices", "xp_ledger", "badges"] as const;
await wait("all tables filled", 150, async () => {
  for (const t of tables) if ((await countTable(db, t)) === 0) return false;
  return (await countSnapshots(db)) > 0;
});
const s0 = await countSnapshots(db);
await wait(
  "snapshots grow",
  Number(process.env.SNAPSHOT_INTERVAL || 60) + 30,
  async () => (await countSnapshots(db)) > s0,
);

const before = (await eventsOfType(db, ["RebalanceExecuted"])).length;
const keeperInterval = Number(process.env.KEEPER_INTERVAL || 30);
await run(["bun", "scripts/price.ts", "--asset", "AAPLx", "--pct", "+30"]);
await wait("keeper rebalance after +30%", keeperInterval * 2 + 20, async () => {
  const ev = await eventsOfType(db, ["RebalanceExecuted"]);
  return (
    ev.length > before &&
    ev.some((e) => (e.data as { executor: string }).executor === c.keeper.address)
  );
});
await run(["bun", "scripts/price.ts", "--asset", "AAPLx", "--pct", "-23.08"]);

const pre = "SPACEX-pre";
const oldMint = readDeployment("localnet")?.mints[pre];
if (!oldMint) fail("no SPACEX-pre mint in deployment");
const holders = (await fetchAllIndexes(c)).filter((x) =>
  x.data.assets.some((a) => a.mint === oldMint),
).length;
if (holders === 0) fail("no index holds SPACEX-pre before the IPO");
await run(["bun", "scripts/ipo.ts", "--asset", pre]);
const left = (await fetchAllIndexes(c)).filter((x) =>
  x.data.assets.some((a) => a.mint === oldMint),
).length;
if (left !== 0) fail(`${left} index(es) still hold ${pre} after the IPO`);
log(S, `ok: IPO migrated all ${holders} holder(s)`);
await wait(
  "IpoMigrated indexed",
  30,
  async () => (await eventsOfType(db, ["IpoMigrated"])).length >= 1,
);
log(S, "PASS");
process.exit(0);
