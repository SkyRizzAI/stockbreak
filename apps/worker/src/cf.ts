/**
 * Cloudflare Workers entry (Cron Trigger, apps/worker/wrangler.jsonc; D050). main.ts stays
 * the Bun entry for local runs.
 *
 * The cron fires every minute; each invocation runs the loops of main.ts for WINDOW_MS,
 * so sub-minute loops (price 15 s, indexer 2 s) keep their cadence and the oracle stays
 * well inside its max age. Loops of a minute or more run once per invocation, or every
 * Nth minute. Keep the loop list in sync with main.ts.
 */
import { AsyncLocalStorage } from "node:async_hooks";
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

/** No new tick starts after this; a running tick may finish before the next minute. */
const WINDOW_MS = 40_000;

// Same per-request scope contract as OpenNext: @repo/db opens its clients in it.
const scope = new AsyncLocalStorage<{ env: unknown; ctx: object }>();
Object.defineProperty(globalThis, Symbol.for("__cloudflare-context__"), {
  get: () => scope.getStore(),
  configurable: true,
});
// The loops use Bun.sleep; Workers only have timers.
(globalThis as unknown as { Bun?: unknown }).Bun ??= {
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function tick(c: WorkerCtx, l: Loop): Promise<void> {
  try {
    await l.run(c);
  } catch (e) {
    c.log(l.name, `error: ${describeError(e)}`);
  }
}

async function repeat(c: WorkerCtx, l: Loop, deadline: number, skipFirst: boolean) {
  for (let first = true; Date.now() < deadline; first = false) {
    const t0 = Date.now();
    if (!(first && skipFirst)) await tick(c, l);
    const wait = Math.max(250, l.everySecs * 1000 - (Date.now() - t0));
    if (Date.now() + wait >= deadline) return;
    await sleep(wait);
  }
}

async function runWindow(scheduledTime: number): Promise<void> {
  const start = Date.now();
  const deadline = start + WINDOW_MS;
  const minute = Math.floor(scheduledTime / 60_000);
  const c = await createWorkerCtx();
  const e = c.env;
  try {
    c.log("worker", `cron cluster=${e.CLUSTER} rpc=${redact(e.RPC_URL)} price=${e.PRICE_MODE}`);
    // Price first so oracles are fresh before anything reads them.
    await tick(c, { name: "price", everySecs: e.PRICE_INTERVAL, run: priceTick });
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
    await Promise.all(
      loops.map((l) => {
        if (l.everySecs < 60) return repeat(c, l, deadline, l.name === "price");
        const every = Math.max(1, Math.round(l.everySecs / 60));
        return minute % every === 0 ? tick(c, l) : Promise.resolve();
      }),
    );
  } finally {
    await closeDb(e.DATABASE_URL).catch(() => {});
    c.log("worker", `window done in ${Math.round((Date.now() - start) / 1000)}s`);
  }
}

export default {
  async scheduled(controller: { scheduledTime: number }, env: unknown, ctx: object) {
    await scope.run({ env, ctx }, () => runWindow(controller.scheduledTime));
  },
  async fetch(): Promise<Response> {
    return new Response("stockbreak worker: cron only\n", { status: 404 });
  },
};
