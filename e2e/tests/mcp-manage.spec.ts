/**
 * Assistant mode, managing an index (D048): the MCP prepares, the creator signs on /sign.
 * Create an index with the dev wallet → build_propose_update → sign → pending banner →
 * build_apply_update → sign → banner gone → build_set_paused → sign → paused →
 * build_claim_fees → sign.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, type Page, test } from "@playwright/test";
import { connectDevWallet, finishWizard } from "./helpers";

const MCP_URL = process.env.E2E_MCP_URL ?? "http://127.0.0.1:3333/mcp";
type Res = { content: { text: string }[]; isError?: boolean };

async function mcp<T>(name: string, args: Record<string, unknown>) {
  const c = new Client({ name: "e2e", version: "1" }, { versionNegotiation: { mode: "auto" } });
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  try {
    const r = (await c.callTool({ name, arguments: args })) as Res;
    const text = r.content.map((x) => x.text).join("\n");
    const i = text.indexOf("\n\n");
    return {
      error: r.isError ? text : null,
      text,
      data: (!r.isError && i >= 0 ? JSON.parse(text.slice(i + 2)) : null) as T,
    };
  } finally {
    await c.close();
  }
}

async function build(name: string, args: Record<string, unknown>) {
  const r = await mcp<{ intentId: string; signUrl: string; signer?: string }>(name, args);
  if (r.error) throw new Error(`${name}: ${r.error}`);
  return r.data;
}

/** Open a sign link in the same browser (same dev wallet) and sign it. */
async function sign(page: Page, signUrl: string, title: RegExp) {
  const u = new URL(signUrl);
  await page.goto(`${u.pathname}${u.search}`);
  await expect(page.getByTestId("intent-title")).toContainText(title);
  await page.getByTestId("intent-sign").click();
  await expect(page.getByText("Done. You can return to your agent.")).toBeVisible({
    timeout: 120_000,
  });
}

test("MCP manage: propose, apply, pause and claim through /sign", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("/create");
  await connectDevWallet(page);
  await page.getByTestId("asset-AAPLx").click();
  await page.getByTestId("asset-MSFTx").click();
  const t = String(Date.now() % 10_000);
  const path = await finishWizard(page, {
    name: `MCP Manage ${t}`,
    symbol: `MM${t}`,
    deposit: "20",
  });
  const index = path.split("/").pop() as string;

  // Validation fails before a link is made.
  const bad = await mcp("build_propose_update", { index, fees: { managementPct: 9 } });
  expect(bad.error).toBeTruthy();
  const bench = await mcp("build_propose_update", {
    index,
    assets: [{ symbol: "SPYx", weightPct: 100 }],
  });
  expect(bench.error).toContain("benchmark");

  // Propose new weights (MSFTx left out: kept at 0% because the vault holds it).
  const p = await build("build_propose_update", {
    index,
    assets: [
      { symbol: "AAPLx", weightPct: 70 },
      { symbol: "NVDAx", weightPct: 30 },
    ],
    strategy: { maxSlippagePct: 2 },
  });
  const pu = new URL(p.signUrl);
  await page.goto(`${pu.pathname}${pu.search}`);
  await expect(page.getByTestId("intent-title")).toContainText(/Propose update/);
  await expect(page.getByText("Kept at 0% until sold")).toBeVisible();
  await page.getByTestId("intent-sign").click();
  await expect(page.getByText("Done. You can return to your agent.")).toBeVisible({
    timeout: 120_000,
  });
  await page.goto(path);
  await expect(page.getByTestId("pending-banner")).toBeVisible();

  // Apply once the timelock has passed (0 on localnet, 120 s on devnet).
  let apply: { signUrl: string } | null = null;
  await expect
    .poll(
      async () => {
        const r = await mcp<{ signUrl: string }>("build_apply_update", { index });
        if (!r.error) apply = r.data;
        return r.error ?? "ok";
      },
      { timeout: 200_000, intervals: [5_000] },
    )
    .toBe("ok");
  await sign(page, (apply as unknown as { signUrl: string }).signUrl, /Apply the update/);
  await page.goto(path);
  await expect(page.getByTestId("pending-banner")).toHaveCount(0);

  // Nothing pending any more: cancel explains itself.
  expect((await mcp("build_cancel_update", { index })).error).toContain("no pending update");

  // Pause.
  const pz = await build("build_set_paused", { index, paused: true });
  await sign(page, pz.signUrl, /Pause/);
  await page.goto(path);
  await expect(page.getByText("Index is paused").first()).toBeVisible({ timeout: 30_000 });
  expect((await mcp("build_set_paused", { index, paused: true })).error).toContain(
    "already paused",
  );

  // Claim creator fees (1%/yr management fee accrues on the first deposit).
  const cf = await build("build_claim_fees", { index });
  await sign(page, cf.signUrl, /Claim creator fees/);
});
