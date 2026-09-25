/**
 * MCP integration tests against the running localnet stack (bun run dev + seed).
 * Uses an in-process Streamable HTTP client (no socket).
 */
import "../src/boot";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "../src/server";

process.env.AGENT_KEYPAIR_PATH ||= ".keys/agent.json";

// Needs the running stack (web API, RPC, DB): `bun run e2e` runs this suite after starting it.
const WEB = process.env.WEB_URL || "http://localhost:3000";
const stackUp = await fetch(`${WEB}/api/config`, { signal: AbortSignal.timeout(3_000) })
  .then((r) => r.ok)
  .catch(() => false);
if (!stackUp) console.warn(`[mcp.test] skipped: stack not running at ${WEB} (run via bun run e2e)`);
const d = stackUp ? describe : describe.skip;

const handler = createMcpHandler(() => createServer());
const client = new Client({ name: "test", version: "1" }, { versionNegotiation: { mode: "auto" } });

type Res = { content: { type: string; text: string }[]; isError?: boolean };
async function call(name: string, args: Record<string, unknown> = {}): Promise<Res> {
  return (await client.callTool({ name, arguments: args })) as Res;
}
const text = (r: Res) => r.content.map((c) => c.text).join("\n");
const data = <T>(r: Res): T => JSON.parse(text(r).slice(text(r).indexOf("\n\n") + 2)) as T;

beforeAll(async () => {
  if (!stackUp) return;
  const t = new StreamableHTTPClientTransport(new URL("http://127.0.0.1/mcp"), {
    fetch: (u, i) => handler.fetch(new Request(u.toString(), i)),
  });
  await client.connect(t);
});

afterAll(async () => {
  if (stackUp) await client.close();
  await handler.close();
});

d("discovery", () => {
  test("lists every PLAN §7.6 tool and the guide", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    for (const n of [
      "list_assets",
      "list_indexes",
      "get_index",
      "get_index_performance",
      "get_leaderboard",
      "get_portfolio",
      "get_feed",
      "simulate_rebalance",
      "build_create_index",
      "build_join",
      "build_redeem",
      "build_clone",
      "get_intent_status",
      "agent_info",
      "agent_register",
      "agent_create_index",
      "agent_join",
      "agent_rebalance",
      "agent_propose_update",
      "agent_post",
      "agent_redeem",
      "agent_claim_fees",
      "agent_apply_update",
      "agent_cancel_update",
      "agent_get_test_usdc",
    ])
      expect(names).toContain(n);
    for (const t of tools) expect(t.description?.length ?? 0).toBeGreaterThan(20);
    const g = await client.readResource({ uri: "docs://guide" });
    expect(JSON.stringify(g.contents)).toContain("SIMULATED");
  });

  test("never leaks env or secrets", async () => {
    const r = await call("agent_info");
    const s = text(r);
    expect(s).not.toContain(process.env.DATABASE_URL ?? "postgres://");
    expect(s).not.toMatch(/\[\s*\d+\s*,\s*\d+\s*,\s*\d+/); // no keypair byte arrays
  });
});

d("research", () => {
  test("list_assets, list_indexes, get_index, performance, leaderboard", async () => {
    const assets = await call("list_assets");
    expect(assets.isError).toBeFalsy();
    expect(text(assets)).toContain("NVDAx");
    const list = await call("list_indexes", { sort: "aum", limit: 5 });
    expect(data<unknown[]>(list).length).toBeGreaterThan(0);
    const idx = await call("get_index", { index: "MAG4" });
    expect(idx.isError).toBeFalsy();
    expect(data<{ mandate: { mode: string } }>(idx).mandate.mode).toBeTruthy();
    const perf = await call("get_index_performance", { index: "MAG4", range: "1M" });
    expect(text(perf)).toContain("MAG4");
    const lb = await call("get_leaderboard", { board: "creators", creatorType: "ai" });
    expect(lb.isError).toBeFalsy();
    const missing = await call("get_index", { index: "NOPE404" });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain("No index found");
  });
});

d("human in the loop", () => {
  test("build_join stores an intent with a sign link", async () => {
    const r = await call("build_join", { index: "MAG4", usdc: 250 });
    expect(r.isError).toBeFalsy();
    const d = data<{ intentId: string; signUrl: string }>(r);
    expect(d.signUrl).toContain(`/sign?id=${d.intentId}`);
    const st = await call("get_intent_status", { intentId: d.intentId });
    expect(data<{ status: string }>(st).status).toBe("pending");
  });

  test("build_create_index and build_clone validate input", async () => {
    const ok = await call("build_create_index", {
      name: "Chips",
      symbol: "CHIPS",
      assets: [
        { symbol: "NVDAx", weightPct: 60 },
        { symbol: "AAPLx", weightPct: 40 },
      ],
      depositUsdc: 100,
    });
    expect(ok.isError).toBeFalsy();
    const bad = await call("build_create_index", {
      name: "Bad",
      symbol: "BAD",
      assets: [{ symbol: "DOGEx", weightPct: 100 }],
    });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("Unknown asset DOGEx");
    const clone = await call("build_clone", { parent: "MAG4", follow: true });
    expect(clone.isError).toBeFalsy();
    expect(text(clone)).toContain("following the parent");
  });

  test("amounts above the per-action limit are refused", async () => {
    const r = await call("build_join", { index: "MAG4", usdc: 10_000_000 });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("per-action limit");
  });
});

d("agent wallet", () => {
  let created = "";

  test("agent_info and agent_register", async () => {
    const info = await call("agent_info");
    expect(info.isError).toBeFalsy();
    const reg = await call("agent_register", { name: "Atlas (demo agent)" });
    expect(text(reg)).toContain("as an AI agent");
  });

  test("agent_post explains a decision on an index, get_feed shows it", async () => {
    const body = `Test note ${Date.now()}: MAG4 drift is within the band, no rebalance needed. Prices simulated.`;
    const bad = await call("agent_post", { body: "x".repeat(600) });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("under 500");
    const r = await call("agent_post", { body, index: "MAG4", cardVariant: "chart" });
    // A rerun within a minute hits the agent rate limit, which is itself the rule under test.
    if (r.isError) {
      expect(text(r)).toContain("Slow down");
      return;
    }
    const d = data<{ postId: number; url: string }>(r);
    expect(d.postId).toBeGreaterThan(0);
    expect(d.url).toContain("/i/");
    const again = await call("agent_post", { body: `${body} again`, index: "MAG4" });
    expect(again.isError).toBe(true);
    expect(text(again)).toContain("Slow down");
    const feed = await call("get_feed", { index: "MAG4", limit: 5 });
    expect(feed.isError).toBeFalsy();
    expect(text(feed)).toContain(body);
  });

  test("agent_create_index with deposit, then agent_join", async () => {
    const sym = `AG${Date.now() % 100_000}`;
    const r = await call("agent_create_index", {
      name: "Agent Test",
      symbol: sym,
      assets: [
        { symbol: "AAPLx", weightPct: 50 },
        { symbol: "MSFTx", weightPct: 50 },
      ],
      strategy: { mode: "Threshold", driftThresholdPct: 2, cooldownMinutes: 0 },
      depositUsdc: 200,
    });
    expect(text(r)).not.toContain("rejected");
    expect(r.isError).toBeFalsy();
    created = data<{ address: string }>(r).address;
    const j = await call("agent_join", { index: created, usdc: 50 });
    expect(j.isError).toBeFalsy();
  }, 120_000);

  test("mandate violation is rejected with a human message", async () => {
    // AAPLx → MSFTx for most of the NAV pushes weights away from 50/50.
    const sim = await call("simulate_rebalance", {
      index: created,
      sell: "AAPLx",
      buy: "MSFTx",
      amountUsd: 80,
    });
    expect(text(sim)).toContain("would be rejected");
    const r = await call("agent_rebalance", {
      index: created,
      sell: "AAPLx",
      buy: "MSFTx",
      amountUsd: 80,
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/drift|direction/i);
  }, 60_000);

  test("agent_propose_update applies on localnet, then agent_rebalance succeeds", async () => {
    const u = await call("agent_propose_update", {
      index: created,
      assets: [
        { symbol: "AAPLx", weightPct: 70 },
        { symbol: "MSFTx", weightPct: 30 },
      ],
    });
    expect(u.isError).toBeFalsy();
    expect(text(u)).toContain("Updated");
    const sim = await call("simulate_rebalance", { index: created });
    expect(text(sim)).toContain("allowed");
    const r = await call("agent_rebalance", { index: created });
    if (r.isError) console.log(text(r));
    expect(r.isError).toBeFalsy();
    expect(text(r)).toContain("Rebalanced");
  }, 120_000);
});
