/**
 * A18 scenario matrix, on-chain layer: keeper mandate variations, a creator-driven
 * rebalance that phases an asset out to 0% (no dust left), IPO value continuity and
 * MCP input validation. Uses the admin scripts like dod.spec.ts; serial because
 * price shocks and IPOs change global chain state.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { connectDevWallet, expectRun, finishWizard } from "./helpers";

const ROOT = path.resolve(import.meta.dirname, "../..");
const MCP_URL = process.env.E2E_MCP_URL ?? "http://127.0.0.1:3333/mcp";
const T = String(Date.now() % 10_000);

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
  const c = new Client({ name: "a18", version: "1" }, { versionNegotiation: { mode: "auto" } });
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  try {
    const r = (await c.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const text = r.content.map((x) => x.text).join("\n");
    const i = text.indexOf("\n\n");
    let data: Record<string, unknown> = {};
    try {
      data = i >= 0 ? (JSON.parse(text.slice(i + 2)) as Record<string, unknown>) : {};
    } catch {
      // plain-text reply
    }
    return { text, isError: !!r.isError, data };
  } finally {
    await c.close();
  }
}

type Live = { symbol: string; balance: string; valueUsd: number; targetWeightBps: number };
type Detail = { pubkey: string; lastRebalanceTs: number; navLiveUsd: number; live: Live[] };
const detail = async (r: APIRequestContext, pk: string) =>
  (await (await r.get(`/api/indexes/${pk}`)).json()) as Detail;

async function agentIndex(
  sym: string,
  strategy: Record<string, unknown>,
  assets: { symbol: string; weightPct: number }[] = [
    { symbol: "AAPLx", weightPct: 50 },
    { symbol: "MSFTx", weightPct: 50 },
  ],
): Promise<string> {
  const r = await mcp("agent_create_index", {
    name: `A18 ${sym}`,
    symbol: sym,
    assets,
    strategy: { cooldownMinutes: 0, ...strategy },
    depositUsdc: 100,
  });
  expect(r.isError, r.text).toBe(false);
  return r.data.address as string;
}

test("KEEP1: keeper follows the mandate (threshold yes; manual, keeper-off no)", async ({
  request,
}) => {
  const auto = await agentIndex(`KT${T}`, { mode: "Threshold", driftThresholdPct: 5 });
  const manual = await agentIndex(`KM${T}`, { mode: "Manual", allowKeeper: false });
  const off = await agentIndex(`KO${T}`, { mode: "Threshold", allowKeeper: false });
  const before = await Promise.all([auto, manual, off].map((pk) => detail(request, pk)));
  script("price", "--asset", "AAPLx", "--pct", "+40");
  try {
    // Proof the keeper ran: the Threshold index gets rebalanced.
    await expect
      .poll(async () => (await detail(request, auto)).lastRebalanceTs, {
        timeout: 180_000,
        intervals: [5_000],
      })
      .toBeGreaterThan(before[0]?.lastRebalanceTs ?? 0);
    // One more keeper interval: the other mandates must still be untouched.
    await new Promise((r) => setTimeout(r, 40_000));
    expect((await detail(request, manual)).lastRebalanceTs).toBe(before[1]?.lastRebalanceTs);
    expect((await detail(request, off)).lastRebalanceTs).toBe(before[2]?.lastRebalanceTs);
  } finally {
    script("price", "--asset", "AAPLx", "--pct", `${(1 / 1.4 - 1) * 100}`);
  }
});

test("MAN9/F5/F6: phase an asset out to 0% and sell it all with Rebalance now", async ({
  page,
  request,
}) => {
  await page.goto("/create");
  await connectDevWallet(page);
  await page.getByTestId("asset-AAPLx").click();
  await page.getByTestId("asset-MSFTx").click();
  await page.getByTestId("wizard-next").click(); // weights
  await page.getByTestId("wizard-next").click(); // strategy
  await page.getByRole("button", { name: /^Hold/ }).click();
  const pathName = await finishWizard(page, {
    name: `A18 Hold ${T}`,
    symbol: `AH${T}`,
    deposit: "60",
  });
  const pk = pathName.split("/").at(-1) as string;

  await page.goto(`${pathName}/manage`);
  await page.getByTestId("target-AAPLx").fill("100");
  await page.getByTestId("target-MSFTx").fill("0");
  await page.getByTestId("propose-update").click();
  await expectRun(page, "Propose update");
  await expect(page.getByTestId("apply-update")).toBeEnabled({ timeout: 200_000 });
  await page.getByTestId("apply-update").click();
  await expectRun(page, "Apply update");

  // A Hold index never trades by itself: the creator rebalances (after the cooldown).
  const btn = page.getByTestId("rebalance-now");
  await expect(btn).toBeEnabled({ timeout: 150_000 });
  await expect(page.getByTestId("rebalance-preview")).toContainText("MSFTx");
  await btn.click();
  await expectRun(page, "Rebalance");
  await expect
    .poll(async () => (await detail(request, pk)).live.find((a) => a.symbol === "MSFTx")?.balance, {
      timeout: 60_000,
    })
    .toBe("0");
});

test("IPO1/F3: IPO keeps the index value; the old token is delisted everywhere", async ({
  request,
}) => {
  const cfg = (await (await request.get("/api/config")).json()) as {
    assets: { symbol: string; kind: string; listed: boolean; ipoTarget: string | null }[];
  };
  const pre = cfg.assets.find((a) => a.kind === "PreIpo" && a.listed);
  test.skip(!pre, "no listed pre-IPO asset left on this chain");
  const PRE = pre?.symbol as string;
  const idx = await agentIndex(`IP${T}`, { mode: "Manual", allowKeeper: false }, [
    { symbol: PRE, weightPct: 50 },
    { symbol: "NVDAx", weightPct: 50 },
  ]);
  const before = (await detail(request, idx)).navLiveUsd;
  script("ipo", "--asset", PRE);
  const after = (await detail(request, idx)).navLiveUsd;
  expect(Math.abs(after / before - 1)).toBeLessThan(0.03);

  const cfg2 = (await (await request.get("/api/config")).json()) as typeof cfg;
  expect(cfg2.assets.find((a) => a.symbol === PRE)?.listed).toBe(false);
  await expect
    .poll(async () => (await detail(request, idx)).live.map((a) => a.symbol), {
      timeout: 90_000,
    })
    .toContain(pre?.ipoTarget as string);
  // Agents cannot build new positions in the converted token.
  const r = await mcp("build_create_index", {
    name: "Stale pre",
    symbol: `SP${T}`,
    assets: [
      { symbol: PRE, weightPct: 50 },
      { symbol: "AAPLx", weightPct: 50 },
    ],
  });
  expect(r.isError).toBe(true);
  expect(r.text).toMatch(/no longer listed/);
});

test("EXT6: MCP rejects bad input with clear messages", async () => {
  const base = { name: "Bad", symbol: `BD${T}` };
  const cases: [string, Record<string, unknown>, RegExp][] = [
    [
      "build_create_index",
      { ...base, assets: [{ symbol: "AAPLx", weightPct: 100 }], depositUsdc: 0.5 },
      /at least \$1\.10/,
    ],
    [
      "build_create_index",
      {
        ...base,
        assets: [
          { symbol: "NVDAx", weightPct: 50 },
          { symbol: "nvdax", weightPct: 50 },
        ],
      },
      /listed twice|Unknown asset/,
    ],
    ["build_create_index", { ...base, assets: [{ symbol: "SPYx", weightPct: 100 }] }, /benchmark/],
    ["build_join", { index: "MAG4", usdc: 0.5 }, /at least|start at \$1/i],
    ["get_portfolio", { wallet: "../indexes" }, /Not a Solana address/],
    ["build_redeem", { index: "MAG4", shares: 0.0000001 }, /at least 0\.000001/],
  ];
  for (const [tool, args, msg] of cases) {
    const r = await mcp(tool, args);
    expect(r.isError, `${tool} ${JSON.stringify(args)}`).toBe(true);
    expect(r.text, tool).toMatch(msg);
  }
});
