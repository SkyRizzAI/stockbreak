/**
 * PLAN §11.1 scenario on localnet with three dev wallets (A creator, B joiner,
 * C cloner), the MCP agent, and the admin scripts. Needs `bun run dev` + seed
 * (the agent must be registered). Run via `bun run e2e`.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { connectDevWallet, expectRun, finishWizard } from "./helpers";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MCP_URL = process.env.E2E_MCP_URL ?? "http://127.0.0.1:3333/mcp";
const RPC = process.env.E2E_RPC_URL ?? "http://127.0.0.1:8899";
const T = String(Date.now() % 10_000);
/** A pre-IPO asset that has not had its IPO yet on this chain (picked in beforeAll). */
let PRE = "OPENAI-pre";

test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

function script(name: string, ...args: string[]): string {
  return execFileSync("bun", ["run", name, "--", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300_000,
  });
}

async function mcp(name: string, args: Record<string, unknown>) {
  const c = new Client({ name: "dod", version: "1" }, { versionNegotiation: { mode: "auto" } });
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  try {
    const r = (await c.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    return { text: r.content.map((x) => x.text).join("\n"), isError: !!r.isError };
  } finally {
    await c.close();
  }
}

type Detail = {
  pubkey: string;
  symbol: string;
  creator: string;
  parent: string | null;
  followsParent: boolean;
  assets: { symbol: string; targetWeightBps: number }[];
  ipoEvents: unknown[];
  navLiveUsd: number;
};

let browser: Browser;
const ctx: Record<"A" | "B" | "C", { context: BrowserContext; page: Page }> = {} as never;
let A = "";
let C = "";
let D = "";

async function api<T>(p: Page, url: string): Promise<T> {
  const r = await p.request.get(url);
  expect(r.ok(), url).toBeTruthy();
  return (await r.json()) as T;
}
const detail = (p: Page, idx: string) => api<Detail>(p, `/api/indexes/${idx}`);

async function usdcBalance(owner: string, mint: string): Promise<number> {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [owner, { mint }, { encoding: "jsonParsed" }],
    }),
  });
  const j = (await r.json()) as {
    result: {
      value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number } } } } } }[];
    };
  };
  return j.result.value.reduce((a, v) => a + v.account.data.parsed.info.tokenAmount.uiAmount, 0);
}

async function faucet(page: Page, amount: string) {
  await page.goto("/faucet");
  await page.getByRole("button", { name: amount, exact: true }).click();
  await page.getByTestId("faucet-usdc").click();
  await expectRun(page, /USDC — done/);
}

async function setSlider(page: Page, label: string, key: "Home" | "End") {
  const s = page.getByRole("slider", { name: label });
  await s.focus();
  await s.press(key);
}

test.beforeAll(async ({ browser: b, request }) => {
  browser = b;
  const cfg = (await (await request.get("/api/config")).json()) as {
    assets: { symbol: string; kind: string; listed: boolean }[];
  };
  const pre = cfg.assets.find((a) => a.kind === "PreIpo" && a.listed);
  if (!pre) throw new Error("no listed pre-IPO asset left — restart the stack (bun run dev)");
  PRE = pre.symbol;
  for (const who of ["A", "B", "C"] as const) {
    const context = await browser.newContext({
      baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    });
    const page = await context.newPage();
    await page.goto("/");
    await connectDevWallet(page);
    ctx[who] = { context, page };
  }
});

test.afterAll(async () => {
  for (const c of Object.values(ctx)) await c.context.close();
});

test("2. A: faucet → create 3 stocks + 1 pre-IPO, Threshold 5%, keeper, fee 5% → zap ≥ $100k", async () => {
  const { page } = ctx.A;
  await faucet(page, "500,000");
  await page.goto("/create");
  for (const s of ["NVDAx", "AAPLx", "MSFTx", PRE]) await page.getByTestId(`asset-${s}`).click();
  await page.getByTestId("wizard-next").click(); // weights: equal 25% each
  await page.getByTestId("wizard-next").click(); // strategy: rebalance on drift, 5%, keeper on (defaults)
  await setSlider(page, "Cooldown", "Home");
  await page.getByTestId("wizard-next").click(); // fees
  await setSlider(page, "Management fee", "End");
  const path_ = await finishWizard(page, {
    name: `DoD Alpha ${T}`,
    symbol: `DODA${T}`,
    deposit: "100000",
  });
  A = path_.split("/").at(-1) as string;
  const d = await detail(page, A);
  expect(d.assets.map((a) => a.symbol).sort()).toEqual(["AAPLx", "MSFTx", "NVDAx", PRE].sort());
  await expect
    .poll(async () => (await detail(page, A)).navLiveUsd, { timeout: 30_000 })
    .toBeGreaterThan(97_000); // zap keeps a ~1% slippage buffer in the wallet
});

test("3. B: open A's link → join $1,000 → position, NAV and chart", async () => {
  const { page } = ctx.B;
  await page.goto(`/i/${A}`);
  await page.getByTestId("join-amount").fill("1000");
  await page.getByTestId("join-submit").click();
  await expectRun(page, /Joined DODA/);
  await expect(page.getByTestId("share-price")).toBeVisible();
  // First snapshot lands within a minute; the chart then shows snapshot + live point.
  await expect(async () => {
    await page.reload();
    await expect(page.locator(".recharts-surface").first()).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 150_000, intervals: [10_000] });
  await page.goto("/portfolio");
  await expect(page.getByTestId("position-row").filter({ hasText: `DODA${T}` })).toBeVisible({
    timeout: 60_000,
  });
});

test("4. C: clone A with new weights + $100k; D follows A", async () => {
  const { page } = ctx.C;
  await faucet(page, "500,000");
  await page.goto(`/create?clone=${A}`);
  await page.getByTestId("wizard-next").click();
  await page.getByTestId("weight-NVDAx").fill("40");
  await page.getByTestId("weight-AAPLx").fill("20");
  await page.getByTestId("weight-MSFTx").fill("20");
  await page.getByTestId(`weight-${PRE}`).fill("20");
  const pc = await finishWizard(page, {
    name: `DoD Clone ${T}`,
    symbol: `DODC${T}`,
    deposit: "100000",
  });
  C = pc.split("/").at(-1) as string;
  await expect(page.getByText(`clone of DODA${T}`)).toBeVisible({ timeout: 30_000 });
  expect((await detail(page, C)).parent).toBe(A);

  await page.goto(`/create?clone=${A}`);
  const pd = await finishWizard(page, {
    name: `DoD Follow ${T}`,
    symbol: `DODF${T}`,
    deposit: "2000",
    follow: true,
  });
  D = pd.split("/").at(-1) as string;
  const d = await detail(page, D);
  expect(d.parent).toBe(A);
  expect(d.followsParent).toBe(true);
});

test("5. A appoints the agent; MCP leaderboard → simulate → rebalance; mandate violation rejected", async () => {
  const { page } = ctx.A;
  const agents = await api<{ wallet: string }[]>(page, "/api/agents");
  const agent = agents[0]?.wallet as string;
  expect(agent).toBeTruthy();
  await page.goto(`/i/${A}/manage`);
  await page.getByTestId("manager-input").fill(agent);
  await page.getByTestId("manager-add").click();
  await expectRun(page, "Update managers");

  const lb = await mcp("get_leaderboard", { board: "indexes", range: "7d" });
  expect(lb.isError).toBe(false);
  const bad = await mcp("agent_rebalance", {
    index: A,
    sell: "MSFTx",
    buy: "NVDAx",
    amountUsd: 30_000,
  });
  expect(bad.isError).toBe(true);
  expect(bad.text).toMatch(/away from its targets|Total drift/);
  // A small price move creates drift for the agent to fix (manager: no trigger needed).
  script("price", "--asset", "AAPLx", "--pct", "+3");
  await expect
    .poll(async () => (await mcp("simulate_rebalance", { index: A })).text, {
      timeout: 120_000,
      intervals: [5_000],
    })
    .toContain("rebalance allowed");
  const r = await mcp("agent_rebalance", { index: A });
  expect(r.isError, r.text).toBe(false);
  expect(r.text).toContain("Rebalanced");
});

test("6. price +40% → keeper rebalances automatically → activity", async () => {
  const { page } = ctx.A;
  script("warp", "--days", "0.001"); // past the index cooldown
  script("price", "--asset", "NVDAx", "--pct", "+40"); // 25% weight: Δ ≈ 6.8% > 5% (D026)
  try {
    await expect
      .poll(
        async () => {
          const acts = await api<{ type: string; wallet: string | null }[]>(
            page,
            `/api/indexes/${A}/activity`,
          );
          const agents = await api<{ wallet: string }[]>(page, "/api/agents");
          return acts.filter(
            (a) => a.type === "RebalanceExecuted" && a.wallet !== agents[0]?.wallet,
          ).length;
        },
        { timeout: 240_000, intervals: [10_000] },
      )
      .toBeGreaterThan(0);
  } finally {
    // Undo the demo shocks so later steps see normal prices.
    script("price", "--asset", "NVDAx", "--pct", `${(1 / 1.4 - 1) * 100}`);
    script("price", "--asset", "AAPLx", "--pct", `${(1 / 1.03 - 1) * 100}`);
  }
});

test("7. A proposes → applies new weights → D follows", async () => {
  const { page } = ctx.A;
  await page.goto(`/i/${A}/manage`);
  await page.getByTestId("target-NVDAx").fill("35");
  await page.getByTestId("target-AAPLx").fill("25");
  await page.getByTestId("target-MSFTx").fill("20");
  await page.getByTestId(`target-${PRE}`).fill("20");
  await page.getByTestId("propose-update").click();
  await expectRun(page, "Propose update");
  await page.getByTestId("apply-update").click();
  await expectRun(page, "Apply update");
  const key = (d: Detail) =>
    d.assets
      .map((a) => `${a.symbol}:${a.targetWeightBps}`)
      .sort()
      .join(",");
  await expect
    .poll(async () => key(await detail(page, A)), { timeout: 60_000 })
    .toContain("NVDAx:3500");
  const want = key(await detail(page, A));
  await expect
    .poll(async () => key(await detail(page, D)), { timeout: 180_000, intervals: [10_000] })
    .toBe(want);
});

test("8. IPO → A, C, D migrate → timeline + ipo_survivor", async () => {
  const { page } = ctx.A;
  script("ipo", "--asset", PRE);
  for (const idx of [A, C, D])
    await expect
      .poll(async () => (await detail(page, idx)).assets.some((a) => a.symbol === PRE), {
        timeout: 120_000,
        intervals: [5_000],
      })
      .toBe(false);
  await page.goto(`/i/${A}`);
  // The timeline lives in a tab on the index page.
  await page.getByRole("tab", { name: "Timeline" }).click();
  await expect(page.getByText(`IPO: ${PRE} converted to`)).toBeVisible({ timeout: 60_000 });
  const creator = (await detail(page, A)).creator;
  await expect
    .poll(
      async () =>
        (await api<{ badges: { badge: string }[] }>(page, `/api/users/${creator}`)).badges.map(
          (b) => b.badge,
        ),
      {
        timeout: 150_000,
        intervals: [10_000],
      },
    )
    .toContain("ipo_survivor");
});

test("9. warp 30 days → creator, parent and platform fees claimed", async () => {
  const { page } = ctx.A;
  script("warp", "--days", "30");
  const out = script("claim:platform"); // accrues every index, then the treasury claims
  expect(out).toMatch(/DODA\d+: [0-9.]+ shares → treasury/);
  await page.goto(`/i/${A}/manage`);
  await page.getByTestId("claim-creator").click();
  await expectRun(page, "Claim creator fees");
  await page.goto("/portfolio");
  await page.getByTestId(`claim-royalty-DODC${T}`).click();
  await expectRun(page, "Claim royalty");
});

test("10. B redeems to USDC → balance up → position gone", async () => {
  const { page } = ctx.B;
  const cfg = await api<{ assets: { symbol: string; mint: string }[] }>(page, "/api/config");
  const usdc = cfg.assets.find((a) => a.symbol === "USDC")?.mint as string;
  const holders = await api<{ wallet: string }[]>(page, `/api/indexes/${A}/holders`);
  const creator = (await detail(page, A)).creator;
  const b = holders.map((h) => h.wallet).find((w) => w !== creator) as string;
  const before = await usdcBalance(b, usdc);
  await page.goto(`/i/${A}`);
  await page.getByRole("tab", { name: /redeem/i }).click();
  // The share balance refreshes a few seconds after the join lands (devnet).
  const max = page.getByRole("button", { name: /^Max / });
  await expect(max).not.toHaveText(/^Max 0$/, { timeout: 60_000 });
  await max.click();
  await page.getByTestId("redeem-submit").click();
  // Right after the 30-day warp, swaps wait for the feeder's next tick (SDK retries).
  await expectRun(page, `Redeem DODA${T}`, 180_000);
  expect(await usdcBalance(b, usdc)).toBeGreaterThan(before + 900);
  await page.goto("/portfolio");
  await expect
    .poll(
      async () =>
        page
          .getByTestId("position-row")
          .filter({ hasText: `DODA${T}` })
          .count(),
      { timeout: 90_000 },
    )
    .toBe(0);
});

test("11. leaderboard, profile, XP and badges are consistent", async () => {
  const { page } = ctx.A;
  const creator = (await detail(page, A)).creator;
  const badges = async (w: string) =>
    (await api<{ badges: { badge: string }[] }>(page, `/api/users/${w}`)).badges.map(
      (x) => x.badge,
    );
  await expect
    .poll(() => badges(creator), { timeout: 150_000, intervals: [10_000] })
    .toEqual(expect.arrayContaining(["first_index", "cloned", "ai_manager", "ipo_survivor"]));
  // C created an index and B joined A: their first-time badges exist too.
  const cCreator = (await detail(page, C)).creator;
  await expect
    .poll(() => badges(cCreator), { timeout: 90_000, intervals: [10_000] })
    .toEqual(expect.arrayContaining(["first_index"]));
  const p = await api<{ xp: number; level: number }>(page, `/api/users/${creator}`);
  expect(p.xp).toBeGreaterThanOrEqual(50 + 30 * 2 + 20);
  const lb = await api<{ rows: { wallet: string }[] }>(page, "/api/leaderboard?board=creators");
  expect(lb.rows.some((r) => r.wallet === creator)).toBe(true);
  await page.goto(`/u/${creator}`);
  await expect(page.getByTestId("badges")).toContainText(/IPO/i);
  await expect(page.getByTestId("level")).toBeVisible();
});
