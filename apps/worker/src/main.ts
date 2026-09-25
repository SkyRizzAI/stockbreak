/**
 * Worker: one process, independent loops (PLAN §7.4). A failing loop logs and
 * retries on its next tick; it never stops the others.
 */
import { closeDb } from "@repo/db";
import { describeError } from "@repo/sdk";
import { createWorkerCtx, redact, type WorkerCtx } from "./ctx";
import { autopilotTick } from "./loops/autopilot";
import { feesTick, followTick, keeperTick, snapshotTick } from "./loops/chain-jobs";
import { gamificationTick } from "./loops/gamification";
import { fullResync, indexerTick } from "./loops/indexer";
import { priceTick } from "./loops/price";

interface Loop {
  name: string;
  everySecs: number;
  run: (c: WorkerCtx) => Promise<unknown>;
}

let stopping = false;

async function runLoop(c: WorkerCtx, l: Loop): Promise<void> {
  while (!stopping) {
    const t0 = Date.now();
    try {
      await l.run(c);
    } catch (e) {
      c.log(l.name, `error: ${describeError(e)}`);
    }
    const wait = Math.max(250, l.everySecs * 1000 - (Date.now() - t0));
    for (let waited = 0; waited < wait && !stopping; waited += 250) await Bun.sleep(250);
  }
}

async function main(): Promise<void> {
  const c = await createWorkerCtx();
  const e = c.env;
  // Never print RPC API keys (e.g. Helius `?api-key=`); c.log redacts every line too.
  c.log("worker", `cluster=${e.CLUSTER} rpc=${redact(e.RPC_URL)} price=${e.PRICE_MODE}`);
  const loops: Loop[] = [
    { name: "price", everySecs: e.PRICE_INTERVAL, run: priceTick },
    { name: "indexer", everySecs: e.INDEXER_INTERVAL, run: indexerTick },
    { name: "resync", everySecs: e.RESYNC_INTERVAL, run: fullResync },
    { name: "snapshot", everySecs: e.SNAPSHOT_INTERVAL, run: snapshotTick },
    { name: "keeper", everySecs: e.KEEPER_INTERVAL, run: keeperTick },
    { name: "fees", everySecs: Math.min(e.FEES_INTERVAL, 60), run: feesTick },
    { name: "follow", everySecs: e.FOLLOW_INTERVAL, run: followTick },
    { name: "gamification", everySecs: e.GAMIFICATION_INTERVAL, run: gamificationTick },
    { name: "autopilot", everySecs: e.AUTOPILOT_INTERVAL, run: autopilotTick },
  ];
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    c.log("worker", "stopping…");
    await Bun.sleep(500);
    await closeDb(e.DATABASE_URL);
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  // Price first so oracles are fresh before anything reads them.
  await priceTick(c).catch((err) => c.log("price", `initial tick failed: ${describeError(err)}`));
  await Promise.all(loops.map((l) => runLoop(c, l)));
}

await main();
