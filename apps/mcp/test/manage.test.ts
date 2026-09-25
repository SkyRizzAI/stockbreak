/** Input validation of the assistant-mode manage tools (no stack needed). */
import { describe, expect, test } from "bun:test";
import {
  type IndexSnap,
  managersInput,
  planUpdate,
  proposeInput,
  type Resolve,
  resolveManagers,
} from "../src/manage";

const A = "So11111111111111111111111111111111111111112";
const B = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const C = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const MINTS: Record<string, string> = { NVDAX: A, AAPLX: B, TSLAX: C };
const resolve: Resolve = (sym) => {
  const u = sym.toUpperCase();
  if (u === "SPY") throw new Error("SPY is the benchmark and cannot be held by an index.");
  const mint = MINTS[u];
  if (!mint) throw new Error(`Unknown asset ${sym}.`);
  return { mint, symbol: `${u.slice(0, -1)}x` };
};

const snap = (over: Partial<IndexSnap> = {}): IndexSnap => ({
  symbol: "MAG",
  followsParent: false,
  hasPending: false,
  assets: [
    { mint: A, symbol: "NVDAx", balance: 5n, targetWeightBps: 5000 },
    { mint: B, symbol: "AAPLx", balance: 5n, targetWeightBps: 5000 },
  ],
  fees: { mgmtFeeBps: 100, entryFeeBps: 0, exitFeeBps: 0 },
  strategy: {
    mode: "Threshold",
    driftThresholdBps: 500,
    periodSecs: 604_800,
    maxSlippageBps: 100,
    cooldownSecs: 60,
    allowKeeper: true,
  },
  ...over,
});

const parse = (x: unknown) => proposeInput.safeParse(x);

describe("build_propose_update input", () => {
  test("schema enforces the Manage UI limits", () => {
    expect(parse({ index: "MAG", fees: { managementPct: 5.1 } }).success).toBe(false);
    expect(parse({ index: "MAG", fees: { entryPct: 1.5 } }).success).toBe(false);
    expect(parse({ index: "MAG", fees: { exitPct: 2 } }).success).toBe(false);
    expect(parse({ index: "MAG", strategy: { maxSlippagePct: 0.4 } }).success).toBe(false);
    expect(parse({ index: "MAG", strategy: { maxSlippagePct: 6 } }).success).toBe(false);
    expect(parse({ index: "MAG", strategy: { driftThresholdPct: 0 } }).success).toBe(false);
    expect(parse({ index: "MAG", strategy: { driftThresholdPct: 51 } }).success).toBe(false);
    expect(parse({ index: "MAG", strategy: { driftThresholdPct: 0.2 } }).success).toBe(true);
    const eleven = Array.from({ length: 11 }, () => ({ symbol: "NVDAx", weightPct: 1 }));
    expect(parse({ index: "MAG", assets: eleven }).success).toBe(false);
    expect(
      parse({ index: "MAG", fees: { managementPct: 5, entryPct: 1, exitPct: 1 } }).success,
    ).toBe(true);
  });

  test("requires something that changes", () => {
    expect(() => planUpdate(snap(), { index: "MAG" }, resolve)).toThrow("Nothing to update");
    expect(() => planUpdate(snap(), { index: "MAG", fees: { managementPct: 1 } }, resolve)).toThrow(
      "Nothing changes",
    );
  });

  test("keeps funded assets left out at 0%", () => {
    const p = planUpdate(
      snap(),
      { index: "MAG", assets: [{ symbol: "TSLAx", weightPct: 100 }] },
      resolve,
    );
    expect(p.assets).toEqual([
      { mint: C, symbol: "TSLAx", weightBps: 10_000 },
      { mint: A, symbol: "NVDAx", weightBps: 0 },
      { mint: B, symbol: "AAPLx", weightBps: 0 },
    ]);
    expect(p.kept).toEqual(["NVDAx", "AAPLx"]);
    expect(p.immediate).toBe(false);
  });

  test("drops unfunded assets and normalizes weights", () => {
    const s = snap({
      assets: [
        { mint: A, symbol: "NVDAx", balance: 0n, targetWeightBps: 5000 },
        { mint: B, symbol: "AAPLx", balance: 0n, targetWeightBps: 5000 },
      ],
    });
    const p = planUpdate(
      s,
      {
        index: "MAG",
        assets: [
          { symbol: "NVDAx", weightPct: 1 },
          { symbol: "TSLAx", weightPct: 3 },
        ],
      },
      resolve,
    );
    expect(p.kept).toEqual([]);
    expect(p.assets?.map((a) => a.weightBps)).toEqual([2500, 7500]);
  });

  test("rejects benchmark, unknown, duplicate assets and followers", () => {
    const one = (symbol: string) => ({ index: "MAG", assets: [{ symbol, weightPct: 100 }] });
    expect(() => planUpdate(snap(), one("SPY"), resolve)).toThrow("benchmark");
    expect(() => planUpdate(snap(), one("XYZ"), resolve)).toThrow("Unknown asset");
    expect(() =>
      planUpdate(
        snap(),
        {
          index: "MAG",
          assets: [
            { symbol: "NVDAx", weightPct: 50 },
            { symbol: "nvdax", weightPct: 50 },
          ],
        },
        resolve,
      ),
    ).toThrow("twice");
    expect(() => planUpdate(snap({ followsParent: true }), one("TSLAx"), resolve)).toThrow(
      "follows its parent",
    );
  });

  test("too many assets once funded ones are kept", () => {
    const funded = Array.from({ length: 9 }, (_, i) => ({
      mint: `${i + 1}`.repeat(32).slice(0, 32),
      symbol: `S${i}`,
      balance: 1n,
      targetWeightBps: 1000,
    }));
    expect(() =>
      planUpdate(
        snap({ assets: funded }),
        {
          index: "MAG",
          assets: [
            { symbol: "NVDAx", weightPct: 50 },
            { symbol: "AAPLx", weightPct: 50 },
          ],
        },
        resolve,
      ),
    ).toThrow("Too many assets");
  });

  test("fee cut is immediate; a raise waits for the timelock and replaces pending", () => {
    const cut = planUpdate(
      snap({ hasPending: true }),
      { index: "MAG", fees: { managementPct: 0.5 } },
      resolve,
    );
    expect(cut.immediate).toBe(true);
    expect(cut.replacesPending).toBe(false);
    expect(cut.fees).toEqual({ mgmtFeeBps: 50, entryFeeBps: 0, exitFeeBps: 0 });
    const raise = planUpdate(
      snap({ hasPending: true }),
      { index: "MAG", fees: { entryPct: 0.5 } },
      resolve,
    );
    expect(raise.immediate).toBe(false);
    expect(raise.replacesPending).toBe(true);
  });

  test("strategy patch keeps unset fields", () => {
    const p = planUpdate(
      snap(),
      { index: "MAG", strategy: { mode: "Periodic", periodDays: 14 } },
      resolve,
    );
    expect(p.strategy).toEqual({
      mode: "Periodic",
      driftThresholdBps: 500,
      periodSecs: 14 * 86_400,
      maxSlippageBps: 100,
      cooldownSecs: 60,
      allowKeeper: true,
    });
    expect(p.assets).toBeNull();
    expect(p.fees).toBeNull();
  });
});

describe("build_set_managers input", () => {
  const agents = [
    { wallet: B, agentName: "Atlas", handle: "atlas" },
    { wallet: C, agentName: "Nova", handle: null },
  ];
  test("at most 3 entries", () => {
    expect(managersInput.safeParse([A, B, C, A]).success).toBe(false);
    expect(managersInput.safeParse([]).success).toBe(true);
  });
  test("resolves agent names and addresses", () => {
    expect(resolveManagers(["atlas", C], agents, "creator")).toEqual([B, C]);
    expect(resolveManagers(["@Nova"], agents, "creator")).toEqual([C]);
    expect(resolveManagers([], agents, "creator")).toEqual([]);
  });
  test("rejects unknown names, duplicates, the creator and the default key", () => {
    expect(() => resolveManagers(["ghost"], agents, "creator")).toThrow("registered agent");
    expect(() => resolveManagers([B, "Atlas"], agents, "creator")).toThrow("twice");
    expect(() => resolveManagers([A], agents, A)).toThrow("creator");
    expect(() => resolveManagers(["11111111111111111111111111111111"], agents, "creator")).toThrow(
      "not a valid manager",
    );
  });
});

describe("tool registration", () => {
  test("manage tools are listed with descriptions (no stack needed)", async () => {
    const { Client, StreamableHTTPClientTransport } = await import("@modelcontextprotocol/client");
    const { createMcpHandler } = await import("@modelcontextprotocol/server");
    const { createServer } = await import("../src/server");
    const handler = createMcpHandler(() => createServer({ agentTools: false }));
    const client = new Client(
      { name: "t", version: "1" },
      { versionNegotiation: { mode: "auto" } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL("http://127.0.0.1/mcp"), {
        fetch: (u, i) => handler.fetch(new Request(u.toString(), i)),
      }),
    );
    try {
      const { tools } = await client.listTools();
      for (const n of [
        "build_propose_update",
        "build_apply_update",
        "build_cancel_update",
        "build_set_paused",
        "build_set_managers",
        "build_claim_fees",
      ]) {
        const t = tools.find((x) => x.name === n);
        expect(t?.description?.length ?? 0).toBeGreaterThan(40);
      }
      // Schema errors come back as tool errors before any chain or web access.
      const r = (await client.callTool({
        name: "build_propose_update",
        arguments: { index: "MAG", fees: { managementPct: 9 } },
      })) as { isError?: boolean; content: { text: string }[] };
      expect(r.isError).toBe(true);
      expect(JSON.stringify(r.content)).toContain("5%");
      const m = (await client.callTool({
        name: "build_set_managers",
        arguments: { index: "MAG", managers: ["a", "b", "c", "d"] },
      })) as { isError?: boolean };
      expect(m.isError).toBe(true);
    } finally {
      await client.close();
      await handler.close();
    }
  });
});
