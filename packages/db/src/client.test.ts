import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb, getDb, migrateDb, resolveDbUrl } from "./client";
import {
  applyIndexedTx,
  dailyCloses,
  getPosition,
  getUsers,
  insertPrices,
  insertSnapshots,
  latestPrices,
  latestSnapshots,
  sharePricesAt,
} from "./queries";
import { events, indexSnapshots, users } from "./schema";
import { createComment, createPost, deleteComment, getPost, setLike } from "./social";
import { chunkRows, MAX_PARAMS } from "./sqlite";

const TEST_DB = `file:${path.join(tmpdir(), `stockbreak-${randomBytes(6).toString("hex")}.db`)}`;
const db = getDb(TEST_DB);
await migrateDb(TEST_DB);
afterAll(() => closeDb(TEST_DB));

const T = (iso: string) => new Date(iso);

test("relative file URLs resolve against the repo root", () => {
  const u = resolveDbUrl("file:.data/x.db");
  expect(u.startsWith("file:/")).toBe(true);
  expect(u.endsWith(path.join(".data", "x.db"))).toBe(true);
  expect(resolveDbUrl(":memory:")).toBe(":memory:");
});

test("multi-row inserts stay under D1's parameter limit", () => {
  const cols = 7; // index_snapshots
  const chunks = chunkRows(
    indexSnapshots,
    Array.from({ length: 50 }, (_, i) => i),
  );
  for (const c of chunks) expect(c.length * cols).toBeLessThanOrEqual(MAX_PARAMS);
  expect(chunks.flat()).toHaveLength(50);
});

describe("snapshots & prices (DISTINCT ON replacements)", () => {
  test("latest, at-or-before and daily closes per index", async () => {
    const snap = (index: string, ts: string, price: bigint) => ({
      index,
      ts: T(ts),
      navMicroUsd: price * 10n,
      supply: 10n,
      sharePriceMicroUsd: price,
      weights: { a: 1 },
    });
    await insertSnapshots(db, [
      snap("A", "2026-01-01T10:00:00Z", 100n),
      snap("A", "2026-01-01T20:00:00Z", 110n),
      snap("A", "2026-01-02T09:00:00Z", 120n),
      snap("B", "2026-01-01T12:00:00Z", 50n),
    ]);
    const latest = await latestSnapshots(db);
    expect(latest.get("A")?.sharePriceMicroUsd).toBe(120n);
    expect(latest.get("A")?.weights).toEqual({ a: 1 });
    expect(latest.get("B")?.navMicroUsd).toBe(500n);
    const at = await sharePricesAt(db, T("2026-01-01T21:00:00Z"));
    expect(at.get("A")).toBe(110n);
    const closes = await dailyCloses(db, T("2026-01-01T00:00:00Z"));
    expect(closes.get("A")?.map((c) => c.v)).toEqual([110n, 120n]);
    expect(closes.get("A")?.[0]?.ts.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  test("latest price per symbol", async () => {
    await insertPrices(db, [
      { symbol: "X", ts: T("2026-01-01T00:00:00Z"), priceMicroUsd: 1n, source: "t" },
      {
        symbol: "X",
        ts: T("2026-01-01T00:01:00Z"),
        priceMicroUsd: 2n,
        source: "t",
        synthetic: true,
      },
      { symbol: "Y", ts: T("2026-01-01T00:00:30Z"), priceMicroUsd: 9n, source: "t" },
    ]);
    const p = new Map((await latestPrices(db)).map((r) => [r.symbol, r]));
    expect(p.get("X")?.priceMicroUsd).toBe(2n);
    expect(p.get("X")?.synthetic).toBe(true);
    expect(p.get("Y")?.priceMicroUsd).toBe(9n);
  });

  test("u64 above 2^53 is rejected instead of silently rounded", async () => {
    await expect(
      insertSnapshots(db, [
        {
          index: "C",
          ts: new Date(),
          navMicroUsd: 2n ** 60n,
          supply: 1n,
          sharePriceMicroUsd: 1n,
          weights: {},
        },
      ]),
    ).rejects.toThrow();
  });
});

describe("indexer batch", () => {
  test("events, positions and cursor in one batch; replays are no-ops", async () => {
    const ev = (ixIndex: number) => ({
      signature: "sig1",
      ixIndex,
      type: "Joined",
      index: "IDX",
      wallet: "W1",
      slot: 7n,
      data: { n: ixIndex },
      ts: T("2026-01-03T00:00:00Z"),
    });
    const input = {
      program: "prog",
      signature: "sig1",
      slot: 7n,
      events: [ev(0), ev(1)],
      deltas: new Map([
        [
          0,
          {
            wallet: "W1",
            index: "IDX",
            addShares: 100n,
            addCostMicroUsd: 1000n,
            ts: T("2026-01-03T00:00:00Z"),
          },
        ],
        [
          1,
          {
            wallet: "W1",
            index: "IDX",
            addShares: 50n,
            addCostMicroUsd: 600n,
            ts: T("2026-01-03T00:00:00Z"),
          },
        ],
      ]),
    };
    expect(await applyIndexedTx(db, input)).toBe(2);
    expect(await applyIndexedTx(db, input)).toBe(0);
    const pos = await getPosition(db, "W1", "IDX");
    expect(pos?.shares).toBe(150n);
    expect(pos?.costBasisMicroUsd).toBe(1600n);
    expect((await db.select().from(events)).length).toBe(2);
  });

  test("long IN lists use one parameter", async () => {
    await db.insert(users).values({ wallet: "U1", avatarSeed: "U1" });
    const many = [...Array.from({ length: 300 }, (_, i) => `x${i}`), "U1"];
    expect((await getUsers(db, many)).has("U1")).toBe(true);
  });
});

describe("social counters", () => {
  test("like/unlike and comments keep counts from source rows", async () => {
    const p = await createPost(db, { author: "A1", body: "hi", index: null });
    expect(await setLike(db, p.id, "L1", true)).toBe(1);
    expect(await setLike(db, p.id, "L1", true)).toBe(1);
    expect(await setLike(db, p.id, "L2", true)).toBe(2);
    expect(await setLike(db, p.id, "L1", false)).toBe(1);
    const c = await createComment(db, { postId: p.id, author: "C1", body: "yo" });
    expect(c.id).toBeGreaterThan(0);
    expect((await getPost(db, p.id))?.commentCount).toBe(1);
    expect(await deleteComment(db, c.id, "C1")).toBe(true);
    expect((await getPost(db, p.id))?.commentCount).toBe(0);
  });
});

describe("worker lease", () => {
  test("only one holder at a time; expiry and release free it", async () => {
    const { acquireLease, releaseLease } = await import("./autopilot");
    const t0 = new Date("2026-02-01T00:00:00Z");
    expect(await acquireLease(db, "cron", "a", 60_000, t0)).toBe(true);
    expect(await acquireLease(db, "cron", "b", 60_000, new Date(t0.getTime() + 1_000))).toBe(false);
    expect(await acquireLease(db, "cron", "a", 60_000, new Date(t0.getTime() + 2_000))).toBe(true);
    expect(await acquireLease(db, "cron", "b", 60_000, new Date(t0.getTime() + 70_000))).toBe(true);
    await releaseLease(db, "cron", "b");
    expect(await acquireLease(db, "cron", "c", 60_000, new Date(t0.getTime() + 71_000))).toBe(true);
  });
});

test("activity excludes noisy types before the limit", async () => {
  const { activity, insertEvents } = await import("./queries");
  const ev = (i: number, type: string) => ({
    signature: `act${i}`,
    ixIndex: 0,
    type,
    index: "ACT",
    wallet: "W9",
    slot: 1n,
    data: {},
    ts: new Date(Date.UTC(2026, 5, 1, 0, i)),
  });
  await insertEvents(db, [
    ev(0, "Joined"),
    ...Array.from({ length: 5 }, (_, i) => ev(i + 1, "FeesAccrued")),
  ]);
  const rows = await activity(db, { index: "ACT", excludeTypes: ["FeesAccrued"] }, 3);
  expect(rows.map((r) => r.type)).toEqual(["Joined"]);
});
