import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import {
  AUTOPILOT_KEEP_RUNS,
  AUTOPILOT_STALE_MS,
  claimDueAutopilots,
  finishAgentRun,
  getAutopilot,
  getWorkerStatus,
  hasRunningRun,
  listAgentRuns,
  requestAutopilotRun,
  saveAutopilot,
  setWorkerStatus,
} from "./autopilot";
import { closeDb, getDb } from "./client";
import { agentAutopilot, agentRuns, agentWallets, workerStatus } from "./schema";

// DB-backed checks against the test database (app_test); skipped when it is not reachable.
const TEST_DB =
  process.env.TEST_DATABASE_URL || "postgres://postgres:postgres@localhost:5434/app_test";
const db = getDb(TEST_DB);
const dbUp = await db
  .execute(sql`select 1 from agent_autopilot limit 1`)
  .then(() => true)
  .catch(() => false);
if (!dbUp) console.warn("[autopilot.test] DB checks skipped: app_test not reachable/migrated");
const d = dbUp ? describe : describe.skip;

const wallets: string[] = [];
const HB = `test-autopilot-${Date.now()}`;
async function newAgent(): Promise<string> {
  const w = `TestPilot${randomBytes(12).toString("hex")}`;
  wallets.push(w);
  await db
    .insert(agentWallets)
    .values({ wallet: w, owner: "test-owner", name: "p", secretEnc: "x" });
  return w;
}
// Far-future clock so rows of other tests / real agents in app_test are never "due" first.
const T0 = new Date("2100-01-01T00:00:00Z");
const at = (mins: number) => new Date(T0.getTime() + mins * 60_000);

/** Claim only this test's agents (others in app_test may be due too). */
async function claimMine(limit: number, now: Date) {
  const all = await claimDueAutopilots(db, limit, now);
  return all.filter((c) => wallets.includes(c.agentWallet));
}

afterAll(async () => {
  if (dbUp && wallets.length) {
    await db.delete(agentRuns).where(inArray(agentRuns.agentWallet, wallets));
    await db.delete(agentAutopilot).where(inArray(agentAutopilot.agentWallet, wallets));
    await db.delete(agentWallets).where(inArray(agentWallets.wallet, wallets));
    await db.delete(workerStatus).where(eq(workerStatus.name, HB));
  }
  await closeDb(TEST_DB);
});

d("autopilot settings, claiming and run log (db)", () => {
  test("defaults, enabling schedules now, disabled agents are never due", async () => {
    const w = await newAgent();
    expect(await getAutopilot(db, w)).toBeNull();
    const off = await saveAutopilot(db, w, { strategy: "hold" }, at(0));
    expect(off).toMatchObject({
      enabled: false,
      intervalMinutes: 30,
      indexes: [],
      nextRunAt: null,
    });
    expect(await claimMine(10, at(1))).toHaveLength(0);

    const on = await saveAutopilot(db, w, { enabled: true, intervalMinutes: 15 }, at(2));
    expect(on.nextRunAt?.toISOString()).toBe(at(2).toISOString());
    expect(on.strategy).toBe("hold");
    // Re-saving while enabled does not reschedule.
    const again = await saveAutopilot(db, w, { enabled: true, strategy: "x" }, at(3));
    expect(again.nextRunAt?.toISOString()).toBe(at(2).toISOString());
  });

  test("claim locks: next_run_at moves forward, a running run blocks a second claim", async () => {
    const w = wallets[0] as string;
    const c = (await claimMine(10, at(4))).find((x) => x.agentWallet === w);
    expect(c?.agentWallet).toBe(w);
    expect(c?.manual).toBe(false);
    const row = await getAutopilot(db, w);
    expect(row?.nextRunAt?.toISOString()).toBe(at(4 + 15).toISOString());
    expect(await hasRunningRun(db, w, at(4))).toBe(true);
    // Even when due again, the in-progress run blocks a second claim.
    await db
      .update(agentAutopilot)
      .set({ nextRunAt: at(5) })
      .where(eq(agentAutopilot.agentWallet, w));
    expect(await claimMine(10, at(6))).toHaveLength(0);
    await finishAgentRun(db, c?.runId ?? 0, { status: "noop", summary: "ok", actions: [] }, at(7));
    expect((await getAutopilot(db, w))?.lastRunAt?.toISOString()).toBe(at(7).toISOString());
    const [run] = await listAgentRuns(db, w);
    expect(run).toMatchObject({ status: "noop", summary: "ok" });
  });

  test("concurrent claims never return the same agent twice", async () => {
    const a = await newAgent();
    const b = await newAgent();
    await saveAutopilot(db, a, { enabled: true }, at(100));
    await saveAutopilot(db, b, { enabled: true }, at(100));
    const [x, y] = await Promise.all([claimMine(10, at(101)), claimMine(10, at(101))]);
    const ids = [...(x ?? []), ...(y ?? [])]
      .map((c) => c.agentWallet)
      .filter((v) => v === a || v === b);
    expect(ids.sort()).toEqual([a, b].sort());
  });

  test("max per tick", async () => {
    const ws = [await newAgent(), await newAgent(), await newAgent()];
    for (const w of ws) await saveAutopilot(db, w, { enabled: true }, at(200));
    const first = await claimDueAutopilots(db, 2, at(200));
    expect(first.length).toBeLessThanOrEqual(2);
  });

  test("manual run: queued even when disabled, 409-ish while pending, rate limited", async () => {
    const w = await newAgent();
    expect(await requestAutopilotRun(db, w, at(300))).toEqual({ status: "queued" });
    expect((await requestAutopilotRun(db, w, at(300))).status).toBe("running");
    const c = (await claimMine(50, at(300))).find((x) => x.agentWallet === w);
    expect(c).toMatchObject({ agentWallet: w, manual: true });
    // Disabled agent: no next run after the manual one.
    expect((await getAutopilot(db, w))?.nextRunAt).toBeNull();
    await finishAgentRun(db, c?.runId ?? 0, { status: "ok", summary: "s", actions: [] }, at(301));
    const r = await requestAutopilotRun(db, w, at(302));
    expect(r.status).toBe("rate_limited");
    expect(await requestAutopilotRun(db, w, at(306))).toEqual({ status: "queued" });
  });

  test("stale running rows are closed; run log is pruned", async () => {
    const w = await newAgent();
    const [stale] = await db
      .insert(agentRuns)
      .values({ agentWallet: w, status: "running", startedAt: at(400) })
      .returning({ id: agentRuns.id });
    await claimDueAutopilots(db, 0, new Date(at(400).getTime() + AUTOPILOT_STALE_MS + 1000));
    const [row] = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, stale?.id ?? 0));
    expect(row?.status).toBe("error");

    await db.insert(agentRuns).values(
      Array.from({ length: AUTOPILOT_KEEP_RUNS + 5 }, (_, i) => ({
        agentWallet: w,
        status: "ok",
        startedAt: at(500 + i),
      })),
    );
    const [last] = await db
      .insert(agentRuns)
      .values({ agentWallet: w, status: "running", startedAt: at(600) })
      .returning({ id: agentRuns.id });
    await finishAgentRun(db, last?.id ?? 0, { status: "ok", summary: "", actions: [] }, at(601));
    const all = await db.select().from(agentRuns).where(eq(agentRuns.agentWallet, w));
    expect(all).toHaveLength(AUTOPILOT_KEEP_RUNS);
    expect((await listAgentRuns(db, w, 10))[0]?.id).toBe(last?.id ?? -1);
  });

  test("worker heartbeat", async () => {
    await setWorkerStatus(db, HB, { available: true, model: "m" }, at(0));
    await setWorkerStatus(db, HB, { available: false, reason: "r" }, at(1));
    const s = await getWorkerStatus(db, HB);
    expect(s?.info).toEqual({ available: false, reason: "r" });
    expect(s?.updatedAt.toISOString()).toBe(at(1).toISOString());
  });
});
