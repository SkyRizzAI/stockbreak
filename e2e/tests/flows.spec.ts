import { expect, test } from "@playwright/test";
import { connectDevWallet, expectRun, finishWizard, firstIndexHref } from "./helpers";

test.describe.configure({ mode: "serial" });

const tag = () => String(Date.now() % 10_000);

test("onboarding: connect, faucet", async ({ page }) => {
  await page.goto("/faucet");
  await connectDevWallet(page);
  await page.getByTestId("faucet-usdc").click();
  await expectRun(page, /Get .* USDC — done/);
  await page.getByTestId("faucet-sol").click();
  await expectRun(page, "Get SOL");
});

test("join and redeem", async ({ page }) => {
  await page.goto("/");
  await connectDevWallet(page);
  await page.goto(await firstIndexHref(page, "MAG4"));
  await page.getByTestId("join-amount").fill("100");
  await page.getByTestId("join-submit").click();
  await expectRun(page, /Joined MAG4/);

  await page.getByRole("tab", { name: /redeem/i }).click();
  // The share balance refreshes a few seconds after the join lands (devnet).
  const max = page.getByRole("button", { name: /^Max / });
  await expect(max).not.toHaveText(/^Max 0$/, { timeout: 60_000 });
  await max.click();
  await page.getByTestId("redeem-submit").click();
  await expectRun(page, "Redeem MAG4");
});

test("create, then manage: update weights, add manager, pause", async ({ page }) => {
  await page.goto("/create");
  await connectDevWallet(page);
  await page.getByTestId("asset-AAPLx").click();
  await page.getByTestId("asset-NVDAx").click();
  await page.getByTestId("wizard-next").click();
  await expect(page.getByTestId("weight-AAPLx")).toHaveValue("50");
  await expect(page.getByTestId("weight-NVDAx")).toHaveValue("50");
  const t = tag();
  const path = await finishWizard(page, { name: `E2E Duo ${t}`, symbol: `DUO${t}`, deposit: "50" });
  await expect(page.getByRole("heading", { name: `E2E Duo ${t}` })).toBeVisible();

  await page.goto(`${path}/manage`);
  await page.getByTestId("target-AAPLx").fill("60");
  await page.getByTestId("target-NVDAx").fill("40");
  await page.getByTestId("propose-update").click();
  await expectRun(page, "Propose update");
  // Localnet has no timelock; devnet waits 120 s before Apply is enabled.
  await expect(page.getByTestId("apply-update")).toBeEnabled({ timeout: 200_000 });
  await page.getByTestId("apply-update").click();
  await expectRun(page, "Apply update");

  await page.getByTestId("manager-input").fill("11111111111111111111111111111112");
  await page.getByTestId("manager-add").click();
  await expectRun(page, "Update managers");

  await page.getByRole("switch", { name: /paused/i }).click();
  await expectRun(page, "Pause");
  await page.goto(path);
  await expect(page.getByRole("button", { name: "Index is paused" })).toBeVisible();
});

test("clone with follow parent", async ({ page }) => {
  await page.goto("/");
  await connectDevWallet(page);
  const parent = await firstIndexHref(page, "MAG4");
  await page.goto(parent);
  await page.locator(`a[href^="/create?clone="]`).first().click();
  await expect(page).toHaveURL(/\/create\?clone=/);
  const t = tag();
  await finishWizard(page, {
    name: `E2E Clone ${t}`,
    symbol: `CLN${t}`,
    deposit: "25",
    follow: true,
  });
  await expect(page.getByText(/MAG4/).first()).toBeVisible();
});

test("social: follow a creator", async ({ page }) => {
  await page.goto("/");
  await connectDevWallet(page);
  const res = await page.request.get("/api/leaderboard?board=creators");
  expect(res.ok()).toBeTruthy();
  const { rows } = (await res.json()) as { rows: { wallet: string }[] };
  const who = rows[0]?.wallet as string;
  await page.goto(`/u/${who}`);
  await page.getByTestId("follow").click();
  await expect(page.getByTestId("follow")).toHaveText("Following");
});
