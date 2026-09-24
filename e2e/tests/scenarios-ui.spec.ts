/**
 * A16 scenario matrix, UI layer: boundary input in the wizard and Manage, the
 * social session following the wallet, and /sign resuming a half-done flow.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test } from "@playwright/test";
import { connectDevWallet, expectRun, finishWizard } from "./helpers";

test.describe.configure({ mode: "serial" });

const MCP_URL = process.env.E2E_MCP_URL ?? "http://127.0.0.1:3333/mcp";
const tag = () => String(Date.now() % 10_000);

async function mcp<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const c = new Client({ name: "e2e", version: "1" }, { versionNegotiation: { mode: "auto" } });
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  try {
    const r = (await c.callTool({ name, arguments: args })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const text = r.content.map((x) => x.text).join("\n");
    if (r.isError) throw new Error(text);
    return JSON.parse(text.slice(text.indexOf("\n\n") + 2)) as T;
  } finally {
    await c.close();
  }
}

test("CRE3/CRE16: 10-asset cap and no skipping to later steps", async ({ page }) => {
  // Pickable assets change after an IPO (pre-IPO tokens are delisted): read them live.
  const cfg = (await (await page.request.get("/api/config")).json()) as {
    assets: { symbol: string; listed: boolean; benchmark?: boolean }[];
  };
  const pick = cfg.assets.filter((a) => a.listed && !a.benchmark).map((a) => a.symbol);
  expect(pick.length).toBeGreaterThan(10);
  await page.goto("/create");
  // Later steps are locked until the earlier ones are done.
  await expect(page.getByRole("button", { name: /Review/ })).toBeDisabled();
  for (const s of pick.slice(0, 10)) await page.getByTestId(`asset-${s}`).click();
  await page.getByTestId(`asset-${pick[10]}`).click();
  await expect(page.getByText("An index can hold at most 10 assets.")).toBeVisible();
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("weight-total")).toHaveText("Total 100.00%");
});

test("CRE4/CRE7/CRE12: name bytes, symbol and first-deposit minimum", async ({ page }) => {
  await page.goto("/create");
  await connectDevWallet(page);
  await page.getByTestId("asset-AAPLx").click();
  const next = page.getByTestId("wizard-next");
  while (await next.isVisible()) await next.click();
  // 30 characters but 40+ UTF-8 bytes: the program counts bytes.
  await page.getByTestId("index-name").fill("Ünïcødé Élite Tëch Stöcks Fund");
  await expect(page.getByText(/Too long: \d+ of 32 bytes/)).toBeVisible();
  await page.getByTestId("index-name").fill("Scenario Bytes");
  await page.getByTestId("index-symbol").fill("SCN");
  const create = page.getByTestId("wizard-create");
  // $0.50 is below the vault's $1 floor after spread: blocked before signing.
  await page.getByTestId("index-deposit").fill("0.5");
  await expect(page.getByText(/first deposit must be at least \$1\.10/)).toBeVisible();
  await expect(create).toBeDisabled();
  await page.getByTestId("index-deposit").fill("99999999");
  await expect(page.getByText("More than your USDC balance.")).toBeVisible();
  await expect(create).toBeDisabled();
  await page.getByTestId("index-deposit").fill("");
  await expect(create).toBeEnabled();
});

test("CRE10: a clone link with a bogus parent explains itself", async ({ page }) => {
  await page.goto("/create?clone=11111111111111111111111111111112");
  await expect(page.getByText("This index could not be loaded")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await page.getByRole("button", { name: /Create from scratch/ }).click();
  await expect(page).toHaveURL(/\/create$/);
  await expect(page.getByTestId("asset-list")).toBeVisible();
});

test("MAN5/MAN6: fee limits, pending banner and replacing a scheduled update", async ({ page }) => {
  await page.goto("/create");
  await connectDevWallet(page);
  await page.getByTestId("asset-AAPLx").click();
  await page.getByTestId("asset-MSFTx").click();
  const t = tag();
  const path = await finishWizard(page, {
    name: `Scn Manage ${t}`,
    symbol: `SM${t}`,
    deposit: "20",
  });

  await page.goto(`${path}/manage`);
  const mgmt = page.getByRole("textbox", { name: "Mgmt fee %/yr" });
  await mgmt.fill("10");
  await mgmt.blur();
  await expect(page.getByTestId("propose-update")).toBeDisabled();
  await mgmt.fill("1");
  await mgmt.blur();

  await page.getByTestId("target-AAPLx").fill("60");
  await page.getByTestId("target-MSFTx").fill("40");
  await page.getByTestId("propose-update").click();
  await expectRun(page, "Propose update");

  // Investors see what is scheduled on the public page.
  await page.goto(path);
  await expect(page.getByTestId("pending-banner")).toBeVisible();

  // A second proposal must say it replaces the first (and restarts the timelock).
  await page.goto(`${path}/manage`);
  await page.getByTestId("target-AAPLx").fill("70");
  await page.getByTestId("target-MSFTx").fill("30");
  await page.getByTestId("propose-update").click();
  await expect(page.getByTestId("propose-update")).toHaveText("Replace scheduled update");
  await page.getByTestId("propose-update").click();
  await expectRun(page, "Propose update");
  await expect(page.getByTestId("apply-update")).toBeEnabled({ timeout: 200_000 });
  await page.getByTestId("apply-update").click();
  await expectRun(page, "Apply update");
  await page.goto(path);
  await expect(page.getByTestId("pending-banner")).toHaveCount(0);
});

test("SOC1: disconnecting the wallet ends the social session", async ({ page }) => {
  await page.goto("/feed");
  await connectDevWallet(page);
  // A new wallet lands on an empty Following tab, which offers the All feed.
  await page.getByRole("button", { name: "See all posts" }).click();
  // A like signs the wallet in (one message signature, auto-approved by the dev wallet).
  const like = page.getByTestId("like-button").first();
  await like.click();
  await expect
    .poll(
      async () =>
        ((await (await page.request.get("/api/auth/session")).json()) as { wallet: string | null })
          .wallet,
      { timeout: 30_000 },
    )
    .not.toBeNull();
  await like.click(); // leave the post as it was
  await page.getByTestId("wallet-menu").click();
  await page.getByRole("menuitem", { name: "Disconnect" }).click();
  await expect(page.getByTestId("connect-wallet").first()).toBeVisible();
  await expect
    .poll(
      async () =>
        ((await (await page.request.get("/api/auth/session")).json()) as { wallet: string | null })
          .wallet,
      { timeout: 15_000 },
    )
    .toBeNull();
});

test("EXT3: /sign resumes after an interruption without swapping twice", async ({ page }) => {
  const r = await mcp<{ intentId: string; signUrl: string }>("build_join", {
    index: "MAG4",
    usdc: 30,
  });
  const url = new URL(r.signUrl);
  await page.goto(`${url.pathname}${url.search}`);
  await connectDevWallet(page);
  // Let step 0 (the swaps) through, then cut the connection before the join step.
  let calls = 0;
  await page.route("**/api/intents/*/tx", (route) => {
    calls += 1;
    return calls === 2 ? route.abort() : route.continue();
  });
  await page.getByTestId("intent-sign").click();
  await expect(page.getByText(/already went through; signing again continues/)).toBeVisible({
    timeout: 120_000,
  });
  const mid = (await (await page.request.get(`/api/intents/${r.intentId}`)).json()) as {
    signatures: string[];
    resumed: boolean;
  };
  expect(mid.resumed).toBe(true);
  const swaps = mid.signatures.length;
  expect(swaps).toBeGreaterThan(0);
  await page.unroute("**/api/intents/*/tx");
  await expect(page.getByTestId("intent-sign")).toHaveText("Continue signing");
  await page.getByTestId("intent-sign").click();
  await expect(page.getByText("Done. You can return to your agent.")).toBeVisible({
    timeout: 120_000,
  });
  const end = (await (await page.request.get(`/api/intents/${r.intentId}`)).json()) as {
    status: string;
    signatures: string[];
  };
  expect(end.status).toBe("executed");
  // Only the join was added: the swaps were not repeated.
  expect(end.signatures.length).toBe(swaps + 1);
});

test("CRE6/JOIN/RED: empty index first deposit, bad amounts, exact Max redeem", async ({
  page,
}) => {
  await page.goto("/create");
  await connectDevWallet(page);
  await page.getByTestId("asset-NVDAx").click();
  await page.getByTestId("asset-GOOGLx").click();
  const t = tag();
  // No deposit: the index starts empty and the first join must meet the vault floor.
  const path = await finishWizard(page, { name: `Scn Empty ${t}`, symbol: `SE${t}`, deposit: "" });
  await page.goto(path);
  const amount = page.getByTestId("join-amount");
  await amount.fill("1");
  await expect(page.getByText(/first deposit must be at least \$1\.10/)).toBeVisible();
  await expect(page.getByTestId("join-submit")).toBeDisabled();
  await amount.fill("0");
  await expect(page.getByTestId("join-submit")).toBeDisabled();
  await amount.fill("99999999");
  await expect(page.getByRole("button", { name: /Not enough USDC/ })).toBeVisible();
  await amount.fill("2");
  await page.getByTestId("join-submit").click();
  await expectRun(page, new RegExp(`Joined SE${t}`));

  await page.getByRole("tab", { name: /redeem/i }).click();
  const redeem = page.getByTestId("redeem-amount");
  await redeem.fill("0.0000001");
  await expect(page.getByText("Enter an amount greater than zero.")).toBeVisible();
  await redeem.fill("999999");
  await expect(page.getByText("You do not hold that many shares.")).toBeVisible();
  const max = page.getByRole("button", { name: /^Max / });
  await expect(max).not.toHaveText(/^Max 0$/, { timeout: 60_000 });
  await max.click();
  await page.getByTestId("redeem-submit").click();
  await expectRun(page, `Redeem SE${t}`);
  // Max burns every raw unit: no 0.000001 dust position is left behind.
  await expect(max).toHaveText(/^Max 0$/, { timeout: 60_000 });
});
