/**
 * A hosted agent's whole life, the way a user drives it (D045–D047):
 * - API: create agent → fund SOL/USDC → API key → through the remote MCP it creates an
 *   index, joins, proposes/cancels an update, earns and claims fees, redeems in two steps;
 *   plus the errors a user is likely to hit (no shares, too much USDC, bad settings).
 * - Autopilot: settings validation, one real "Run now" cycle ends with a logged result.
 * - UI: the AI page walks a new user through sign-in → create → fund → next step.
 */
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { connectDevWallet } from "./helpers";

test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

const ROOT = path.resolve(import.meta.dirname, "../..");
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const T = String(Date.now() % 10_000);

function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

async function signIn(request: APIRequestContext): Promise<string> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const x = publicKey.export({ format: "jwk" }).x ?? "";
  const wallet = base58(new Uint8Array(Buffer.from(x, "base64url")));
  const n = await request.get(`/api/auth/nonce?wallet=${wallet}&purpose=sign-in`);
  const { message, nonce } = (await n.json()) as { nonce: string; message: string };
  const signature = sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64");
  expect(
    (await request.post("/api/auth/session", { data: { wallet, nonce, signature } })).ok(),
  ).toBe(true);
  return wallet;
}

type Out = { ok: boolean; text: string; data: Record<string, unknown> };

async function tool(key: string, name: string, args: Record<string, unknown> = {}): Promise<Out> {
  const c = new Client(
    { name: "e2e-life", version: "1" },
    { versionNegotiation: { mode: "auto" } },
  );
  await c.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", BASE), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  try {
    const r = (await c.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const text = r.content.map((x) => x.text).join("\n");
    expect(text).not.toContain(key);
    const i = text.indexOf("\n\n");
    let data: Record<string, unknown> = {};
    try {
      data = i >= 0 ? (JSON.parse(text.slice(i + 2)) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }
    return { ok: !r.isError, text, data };
  } finally {
    await c.close();
  }
}

function must(r: Out, what: string): Out {
  if (!r.ok) throw new Error(`${what} failed: ${r.text}`);
  return r;
}

function script(name: string, ...args: string[]): string {
  return execFileSync("bun", ["run", name, "--", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300_000,
  });
}

async function stockSymbols(key: string): Promise<string[]> {
  const r = must(await tool(key, "list_assets"), "list_assets");
  const rows = JSON.stringify(r.data);
  const found = [...rows.matchAll(/"symbol":"([A-Z]{2,6}x)"/g)].map((m) => m[1] as string);
  const uniq = [...new Set(found)];
  expect(uniq.length).toBeGreaterThanOrEqual(2);
  return uniq.slice(0, 2);
}

let shared: { key: string; agent: string; index: string } | null = null;

test("hosted agent: fund, create, join, update, fees, redeem through the remote MCP", async ({
  playwright,
}) => {
  const request = await playwright.request.newContext({ baseURL: BASE });
  try {
    await signIn(request);
    const created = await request.post("/api/me/agents", { data: { name: `Life ${T}` } });
    test.skip(created.status() === 503, "AGENT_KEY_SECRET not set for this stack");
    const agent = ((await created.json()) as { wallet: string }).wallet;

    // Get USDC before any SOL: a clear error, not a crash.
    const early = await request.post(`/api/me/agents/${agent}/fund`, { data: { asset: "USDC" } });
    expect(early.status()).toBeGreaterThanOrEqual(400);
    expect(((await early.json()) as { error: string }).error).toMatch(/SOL/i);

    const sol = await request.post(`/api/me/agents/${agent}/fund`, { data: { asset: "SOL" } });
    expect(sol.ok(), await sol.text()).toBe(true);
    const bad = await request.post(`/api/me/agents/${agent}/fund`, { data: { asset: "BTC" } });
    expect(bad.status()).toBe(400);
    const tooMuch = await request.post(`/api/me/agents/${agent}/fund`, {
      data: { asset: "USDC", amount: 1_000_000 },
    });
    expect(tooMuch.status()).toBe(400);
    const usdc = await request.post(`/api/me/agents/${agent}/fund`, {
      data: { asset: "USDC", amount: 2_000 },
    });
    expect(usdc.ok(), await usdc.text()).toBe(true);
    expect(((await usdc.json()) as { usdc: number }).usdc).toBe(2_000);

    const k = await request.post(`/api/me/agents/${agent}/keys`, { data: { name: "life" } });
    const key = ((await k.json()) as { key: string }).key;

    const info = must(await tool(key, "agent_info"), "agent_info");
    expect(info.text).toContain(agent);

    // Errors a user (or their AI) will meet first.
    const noShares = await tool(key, "agent_redeem", { index: "MAG4", pct: 100 });
    expect(noShares.ok).toBe(false);
    expect(noShares.text).not.toMatch(/undefined|TypeError|stack/i);
    const broke = await tool(key, "agent_join", { index: "MAG4", usdc: 50_000 });
    expect(broke.ok).toBe(false);
    expect(broke.text).not.toMatch(/undefined|TypeError/i);

    must(await tool(key, "agent_get_test_usdc", { amount: 500 }), "agent_get_test_usdc");

    const [a, b] = await stockSymbols(key);
    const symbol = `AL${T}`;
    const create = must(
      await tool(key, "agent_create_index", {
        name: `Agent Life ${T}`,
        symbol,
        assets: [
          { symbol: a, weightPct: 60 },
          { symbol: b, weightPct: 40 },
        ],
        fees: { managementPct: 5 },
        strategy: { mode: "Threshold", cooldownMinutes: 0 },
        depositUsdc: 1_000,
      }),
      "agent_create_index",
    );
    const index = create.data.address as string;
    expect(index).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

    must(await tool(key, "agent_join", { index, usdc: 200 }), "agent_join");

    // A weight change is proposed, visible, then withdrawn.
    const prop = await tool(key, "agent_propose_update", {
      index,
      assets: [
        { symbol: a, weightPct: 50 },
        { symbol: b, weightPct: 50 },
      ],
    });
    must(prop, "agent_propose_update");
    if (/^Proposed/.test(prop.text)) {
      must(await tool(key, "agent_cancel_update", { index }), "agent_cancel_update");
    } else {
      // No timelock (localnet): the update is live at once, nothing is left to cancel.
      expect(prop.text).toMatch(/^Updated/);
    }
    const again = await tool(key, "agent_cancel_update", { index });
    expect(again.ok).toBe(false);
    expect(again.text).toMatch(/no pending update/i);

    // Management fees accrue over time; the agent (creator) claims them.
    // Localnet can time-travel 30 days; on devnet only seconds of fees have accrued.
    const cluster = ((await (await request.get("/api/config")).json()) as { cluster: string })
      .cluster;
    if (cluster === "localnet") script("warp", "--days", "30");
    const claim = await tool(key, "agent_claim_fees", { index });
    if (cluster === "localnet") must(claim, "agent_claim_fees");
    expect(claim.text).toMatch(/claim|fee/i);
    expect(claim.text).not.toMatch(/undefined|TypeError/);

    // Redeem half, then the rest.
    must(await tool(key, "agent_redeem", { index, pct: 50 }), "agent_redeem 50%");
    must(await tool(key, "agent_redeem", { index, pct: 100 }), "agent_redeem 100%");
    const none = await tool(key, "agent_redeem", { index, pct: 100 });
    expect(none.ok).toBe(false);

    // The agent's portfolio no longer holds the index.
    await expect
      .poll(
        async () => {
          const pf = await request.get(`/api/portfolio/${agent}`);
          return JSON.stringify(((await pf.json()) as { positions: unknown[] }).positions);
        },
        { timeout: 60_000 },
      )
      .not.toContain(index);

    shared = { key, agent, index };

    // Autopilot settings: validation.
    const url = `/api/me/agents/${agent}/autopilot`;
    const g = await request.get(url);
    expect(g.ok()).toBe(true);
    const ap = (await g.json()) as { enabled: boolean; indexes: string[] };
    expect(ap.enabled).toBe(false);
    for (const data of [
      { intervalMinutes: 2 },
      { strategy: "x".repeat(1_001) },
      { indexes: ["not-an-address"] },
      { enabled: "yes" },
    ]) {
      const r = await request.put(url, { data });
      expect(r.status(), JSON.stringify(data)).toBe(400);
    }
    const saved = await request.put(url, {
      data: { intervalMinutes: 60, strategy: "Only read the index and report. Never trade." },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    expect(((await saved.json()) as { intervalMinutes: number }).intervalMinutes).toBe(60);
  } finally {
    await request.dispose();
  }
});

test("autopilot: Run now finishes one logged cycle", async ({ playwright }) => {
  test.skip(!shared, "needs the agent from the previous test");
  const request = await playwright.request.newContext({ baseURL: BASE });
  try {
    // A fresh owner + agent that manages nothing: the cycle should end quickly with no action.
    await signIn(request);
    const c = await request.post("/api/me/agents", { data: { name: `Pilot ${T}` } });
    const agent = ((await c.json()) as { wallet: string }).wallet;
    const url = `/api/me/agents/${agent}/autopilot`;
    const g = (await (await request.get(url)).json()) as { available: boolean; reason: string };
    test.skip(!g.available, `autopilot unavailable: ${g.reason}`);

    const run = await request.post(`${url}/run`);
    expect(run.ok(), await run.text()).toBe(true);
    const dup = await request.post(`${url}/run`);
    expect([409, 429]).toContain(dup.status());

    let last: { status: string; summary: string } | undefined;
    await expect
      .poll(
        async () => {
          const s = (await (await request.get(url)).json()) as {
            runs: { status: string; summary: string; finishedAt: string | null }[];
          };
          last = s.runs[0];
          return last && last.status !== "running" ? last.status : "pending";
        },
        { timeout: 300_000, intervals: [5_000] },
      )
      .not.toBe("pending");
    expect(last?.summary ?? "").not.toBe("");
    expect(last?.summary ?? "").not.toMatch(/sbk_|sk-or-|api[_-]?key=/i);
    expect(["ok", "noop"], `run ended: ${last?.status} ${last?.summary}`).toContain(last?.status);
  } finally {
    await request.dispose();
  }
});

test("AI page: new user signs in, creates an agent, funds it, sees the next step", async ({
  page,
}) => {
  await page.goto("/agents");
  await connectDevWallet(page);
  await page.getByTestId("agents-sign-in").click();
  await page.getByTestId("create-agent").first().click();
  await page.getByTestId("name-input").fill(`UI Agent ${T}`);
  await page.getByTestId("name-submit").click();
  const row = page.getByTestId("my-agent").first();
  await expect(row).toBeVisible();
  const next = row.getByTestId("agent-next-step");
  await expect(next).toContainText(/SOL/);
  // Autopilot can't be switched on before the agent manages an index.
  await expect(row.getByTestId("autopilot-toggle")).toBeDisabled();

  await row.getByRole("button", { name: "Fund SOL" }).click();
  await expect(page.getByText(/SOL to UI Agent/)).toBeVisible({ timeout: 60_000 });
  await expect(next).toContainText(/Manage page/, { timeout: 30_000 });

  // A key is shown once with ready-to-paste setups; closing it keeps only the prefix.
  await row.getByTestId("new-key").click();
  await page.getByTestId("name-input").fill("laptop");
  await page.getByTestId("name-submit").click();
  const value = (await page.getByTestId("api-key-value").textContent()) ?? "";
  expect(value).toMatch(/^sbk_/);
  await page.getByRole("button", { name: "I saved it" }).click();
  await expect(row.getByTestId("api-key-row")).toHaveCount(1);
  await expect(page.getByText(value)).toHaveCount(0);

  // The agent creates an index with that key; the card now offers Autopilot on it.
  must(await tool(value, "agent_get_test_usdc", { amount: 100 }), "usdc");
  const [a, b] = await stockSymbols(value);
  const symbol = `UI${T}`;
  must(
    await tool(value, "agent_create_index", {
      name: `UI Agent ${T}`,
      symbol,
      assets: [
        { symbol: a, weightPct: 50 },
        { symbol: b, weightPct: 50 },
      ],
    }),
    "create",
  );
  await page.reload();
  const row2 = page.getByTestId("my-agent").first();
  await expect(row2.getByTestId("agent-next-step")).toContainText(/Autopilot/, { timeout: 30_000 });
  const chip = row2.getByRole("button", { name: symbol });
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  // Switching off the only index is refused with a hint instead of silently saving nothing.
  await chip.click();
  await expect(page.getByText(/Keep at least one index/)).toBeVisible();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(row2.getByTestId("autopilot-toggle")).toBeEnabled();
});

// Costs LLM tokens and takes minutes: opt in with E2E_AUTOPILOT_LLM=1 (used for the devnet pass).
test("autopilot with a real LLM reviews an index it manages and logs what it did", async ({
  playwright,
}) => {
  test.skip(!process.env.E2E_AUTOPILOT_LLM, "set E2E_AUTOPILOT_LLM=1 to run");
  const request = await playwright.request.newContext({ baseURL: BASE });
  try {
    await signIn(request);
    const c = await request.post("/api/me/agents", { data: { name: `Pilot LLM ${T}` } });
    const agent = ((await c.json()) as { wallet: string }).wallet;
    const url = `/api/me/agents/${agent}/autopilot`;
    const g = (await (await request.get(url)).json()) as { available: boolean; reason: string };
    test.skip(!g.available, `autopilot unavailable: ${g.reason}`);
    expect((await request.post(`/api/me/agents/${agent}/fund`, { data: {} })).ok()).toBe(true);
    const usdc = await request.post(`/api/me/agents/${agent}/fund`, {
      data: { asset: "USDC", amount: 300 },
    });
    expect(usdc.ok(), await usdc.text()).toBe(true);
    const key = (
      (await (
        await request.post(`/api/me/agents/${agent}/keys`, { data: { name: "llm" } })
      ).json()) as { key: string }
    ).key;
    const [a, b] = await stockSymbols(key);
    const create = must(
      await tool(key, "agent_create_index", {
        name: `Pilot ${T}`,
        symbol: `PL${T}`,
        assets: [
          { symbol: a, weightPct: 50 },
          { symbol: b, weightPct: 50 },
        ],
        depositUsdc: 100,
      }),
      "create",
    );
    const index = create.data.address as string;
    const saved = await request.put(url, {
      data: {
        enabled: true,
        intervalMinutes: 1440,
        indexes: [index],
        strategy:
          "Check drift. Rebalance only if drift is above the trigger. Then publish one short, factual agent_post on the index describing its current weights. Never change fees.",
      },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    const run = await request.post(`${url}/run`);
    expect(run.ok(), await run.text()).toBe(true);

    let last:
      | { status: string; summary: string; actions: { tool: string; ok: boolean }[] }
      | undefined;
    await expect
      .poll(
        async () => {
          const s = (await (await request.get(url)).json()) as { runs: NonNullable<typeof last>[] };
          last = s.runs[0];
          return last && last.status !== "running" ? last.status : "pending";
        },
        { timeout: 420_000, intervals: [10_000] },
      )
      .not.toBe("pending");
    console.log(`autopilot run: ${last?.status} · ${last?.summary}`);
    console.log(
      `actions: ${last?.actions.map((x) => `${x.tool}${x.ok ? "" : "(failed)"}`).join(", ")}`,
    );
    expect(["ok", "noop"], `run ended: ${last?.status} ${last?.summary}`).toContain(last?.status);
    expect(last?.summary ?? "").not.toMatch(/sbk_|sk-or-|api[_-]?key=/i);
    // Turning it off stops scheduled runs.
    const off = await request.put(url, { data: { enabled: false } });
    expect(((await off.json()) as { enabled: boolean }).enabled).toBe(false);
  } finally {
    await request.dispose();
  }
});
