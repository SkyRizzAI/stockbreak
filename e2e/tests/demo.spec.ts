/**
 * Demo recording for the technical video (docs/SUBMISSION.md). Only with E2E_DEMO=1
 * (`bun run demo:record`). Every normal-scenario flow is its own 1920×1080 clip in
 * e2e/demo/ so it can be trimmed and narrated. Runs on a fresh localnet stack.
 *
 * Wallets: "creator" (makes AINFRA, owns an AI agent) and "investor" (joins, redeems,
 * clones, comments). Each is a dev wallet kept in a saved storage state between scenes.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { closeTxOverlay, connectDevWallet, expectRun, finishWizard } from "./helpers";

test.skip(!process.env.E2E_DEMO, "demo recording runs via bun run demo:record");
test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "e2e/demo");
const STATE = {
  creator: path.join(ROOT, "e2e/.stack/demo-creator.json"),
  investor: path.join(ROOT, "e2e/.stack/demo-investor.json"),
};
const MCP_URL = process.env.E2E_MCP_URL ?? "http://127.0.0.1:3333/mcp";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SIZE = { width: 1920, height: 1080 };
let indexPath = "";

const script = (name: string, ...args: string[]) =>
  execFileSync("bun", ["run", name, "--", ...args], { cwd: ROOT, encoding: "utf8" });
const beat = (page: Page, ms = 1500) => page.waitForTimeout(ms);

type Who = keyof typeof STATE;

/** One recorded scene: fresh context (optionally as a saved wallet), video saved as `name`. */
async function scene(
  browser: Browser,
  name: string,
  body: (page: Page) => Promise<void>,
  opts: { as?: Who; save?: Who } = {},
) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: SIZE,
    recordVideo: { dir: path.join(OUT, ".raw"), size: SIZE },
    storageState: opts.as ? STATE[opts.as] : undefined,
  });
  const page = await context.newPage();
  try {
    await body(page);
    if (opts.save) await context.storageState({ path: STATE[opts.save] });
  } finally {
    await page.close();
    await page.video()?.saveAs(path.join(OUT, `${name}.webm`));
    await context.close();
  }
}

async function smoothScroll(page: Page, px: number, steps = 14) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await page.waitForTimeout(90);
  }
}

/** Type like a person, so the viewer can follow. */
const typeIn = (page: Page, testId: string, text: string, delay = 40) =>
  page.getByTestId(testId).pressSequentially(text, { delay });

async function mcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const c = new Client({ name: "demo", version: "1" }, { versionNegotiation: { mode: "auto" } });
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  try {
    const r = (await c.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return r.content.map((x) => x.text).join("\n");
  } finally {
    await c.close();
  }
}

test.beforeAll(() => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
});

test("00 landing page", async ({ browser }) => {
  await scene(browser, "00-landing", async (page) => {
    await page.goto("/");
    await beat(page, 3000);
    for (let i = 0; i < 6; i++) {
      await smoothScroll(page, 800);
      await beat(page, 1200);
    }
    await page.goto("/home");
    await beat(page, 2500);
  });
});

test("01 markets: home, explore, search, index detail", async ({ browser }) => {
  await scene(browser, "01-markets", async (page) => {
    await page.goto("/home");
    await beat(page, 2500);
    await smoothScroll(page, 900);
    await beat(page);
    await page.goto("/explore");
    await beat(page, 2500);
    await smoothScroll(page, 700);
    await beat(page);
    await page
      .getByRole("button", { name: /Search/ })
      .first()
      .click();
    await page.keyboard.type("Magnif", { delay: 90 });
    await beat(page, 1500);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("prestocks-panel")).toBeVisible();
    await beat(page, 2500);
    await smoothScroll(page, 700);
    await beat(page, 2000);
    await page.getByTestId("prestocks-panel").scrollIntoViewIfNeeded();
    await beat(page, 3000);
  });
});

test("02 onboarding: dev wallet, test USDC and SOL", async ({ browser }) => {
  await scene(
    browser,
    "02-onboarding",
    async (page) => {
      await page.goto("/faucet");
      await beat(page, 1500);
      await connectDevWallet(page);
      await beat(page, 1500);
      await page.getByTestId("faucet-usdc").click();
      await expectRun(page, /Get .* USDC — done/);
      await beat(page, 2000);
    },
    { save: "creator" },
  );
});

test("03 create an index", async ({ browser }) => {
  await scene(
    browser,
    "03-create",
    async (page) => {
      await page.goto("/create");
      await beat(page, 1500);
      for (const s of ["NVDAx", "MSFTx", "ANTHRP-pre"]) {
        await page.getByTestId(`asset-${s}`).click();
        await beat(page, 700);
      }
      await page.getByTestId("wizard-next").click();
      await beat(page, 2500);
      indexPath = await finishWizard(page, {
        name: "AI Infra + Anthropic",
        symbol: "AINFRA",
        deposit: "2000",
      });
      await expect(page.getByRole("heading", { name: "AI Infra + Anthropic" })).toBeVisible();
      await beat(page, 2500);
      await smoothScroll(page, 800);
      await beat(page, 2500);
    },
    { as: "creator" },
  );
});

test("04 share as a card and as a Blink", async ({ browser }) => {
  await scene(
    browser,
    "04-share",
    async (page) => {
      await page.goto(indexPath);
      await beat(page);
      await page.getByRole("button", { name: "Share" }).click();
      await beat(page, 2000);
      await page.getByText("Copy Blink (Solana Action)").click();
      await beat(page, 2500);
      await page.getByRole("button", { name: "Share" }).click();
      await page.getByTestId("share-to-feed").click();
      await expect(page.getByTestId("share-preview")).toBeVisible();
      await beat(page);
      for (const v of ["tokens", "chart", "mark"]) {
        await page.getByTestId(`card-variant-${v}`).click();
        await beat(page, 1200);
      }
      await page.getByTestId("card-variant-tokens").click();
      await typeIn(
        page,
        "post-input",
        "AI infra + a PreStocks Anthropic sleeve. Rebalances on 5% drift.",
        25,
      );
      await page.getByTestId("post-submit").click();
      await page.getByTestId("tab-all").click();
      await expect(page.getByTestId("post-card").first()).toContainText("AINFRA");
      await beat(page, 3000);
    },
    { as: "creator" },
  );
});

test("05 someone joins", async ({ browser }) => {
  await scene(
    browser,
    "05-join",
    async (page) => {
      await page.goto(indexPath);
      await connectDevWallet(page);
      await beat(page);
      await page.getByTestId("join-amount").fill("");
      await typeIn(page, "join-amount", "300", 150);
      await beat(page, 1500);
      await page.getByTestId("join-submit").click();
      await expectRun(page, /Joined AINFRA/);
      await beat(page, 3000);
    },
    { save: "investor" },
  );
});

test("06 partial redeem", async ({ browser }) => {
  await scene(
    browser,
    "06-redeem",
    async (page) => {
      await page.goto(indexPath);
      await beat(page);
      await page.getByRole("tab", { name: /redeem/i }).click();
      const max = page.getByRole("button", { name: /^Max / });
      await expect(max).not.toHaveText(/^Max 0$/, { timeout: 60_000 });
      await beat(page);
      await page.getByTestId("redeem-amount").fill("");
      await typeIn(page, "redeem-amount", "100", 150);
      await beat(page, 1500);
      await page.getByTestId("redeem-submit").click();
      await expectRun(page, "Redeem AINFRA");
      await beat(page, 3000);
    },
    { as: "investor" },
  );
});

test("07 clone and follow the parent", async ({ browser }) => {
  await scene(
    browser,
    "07-clone",
    async (page) => {
      await page.goto(indexPath);
      await beat(page);
      await page.locator(`a[href^="/create?clone="]`).first().click();
      await expect(page).toHaveURL(/\/create\?clone=/);
      await beat(page, 2500);
      await finishWizard(page, {
        name: "AI Infra Follower",
        symbol: "AIFOL",
        deposit: "50",
        follow: true,
      });
      await beat(page, 3000);
    },
    { as: "investor" },
  );
});

test("08 AI console: create an agent, fund it, API key", async ({ browser }) => {
  await scene(
    browser,
    "08-ai-agents",
    async (page) => {
      await page.goto("/agents");
      await beat(page, 2500);
      await page.getByTestId("how-agents-work").click();
      await beat(page, 4000);
      await page.keyboard.press("Escape");
      await beat(page);
      await page.getByTestId("agents-sign-in").click();
      await page.getByTestId("create-agent").first().click();
      await typeIn(page, "name-input", "Momentum Bot", 70);
      await page.getByTestId("name-submit").click();
      const row = page.getByTestId("my-agent").first();
      await expect(row).toBeVisible();
      await beat(page, 2000);
      await row.getByRole("button", { name: "Fund SOL" }).click();
      await expect(page.getByText(/SOL to Momentum Bot/)).toBeVisible({ timeout: 60_000 });
      await beat(page, 1500);
      await expect(row.getByRole("button", { name: "Get USDC" })).toBeEnabled({ timeout: 30_000 });
      await row.getByRole("button", { name: "Get USDC" }).click();
      await expect(page.getByText(/test USDC to Momentum Bot/)).toBeVisible({ timeout: 60_000 });
      await beat(page, 1500);
      await row.getByTestId("new-key").click();
      await typeIn(page, "name-input", "Claude Code", 60);
      await page.getByTestId("name-submit").click();
      await expect(page.getByTestId("api-key-value")).toBeVisible();
      await beat(page, 4000);
      await page.getByRole("button", { name: "I saved it" }).click();
      await beat(page, 2500);
    },
    // Keep the sign-in session for the manage and autopilot scenes.
    { as: "creator", save: "creator" },
  );
});

test("09 manage: new weights, AI agent as manager, pause", async ({ browser }) => {
  await scene(
    browser,
    "09-manage",
    async (page) => {
      await page.goto(`${indexPath}/manage`);
      await beat(page, 2000);
      for (const [s, v] of [
        ["NVDAx", "45"],
        ["MSFTx", "35"],
        ["ANTHRP-pre", "20"],
      ] as const) {
        await page.getByTestId(`target-${s}`).fill("");
        await typeIn(page, `target-${s}`, v, 120);
      }
      await beat(page);
      await page.getByTestId("propose-update").click();
      await expectRun(page, "Propose update");
      await closeTxOverlay(page);
      await expect(page.getByTestId("apply-update")).toBeEnabled({ timeout: 60_000 });
      await beat(page);
      await page.getByTestId("apply-update").click();
      await expectRun(page, "Apply update");
      await closeTxOverlay(page);
      await beat(page);
      const own = page.getByTestId("manager-own-agent").first();
      await own.scrollIntoViewIfNeeded();
      await beat(page);
      await own.click();
      await beat(page);
      await page.getByTestId("manager-add").click();
      await expectRun(page, "Update managers");
      await closeTxOverlay(page);
      await beat(page, 2000);
      const paused = page.getByRole("switch", { name: /paused/i });
      await paused.scrollIntoViewIfNeeded();
      await paused.click();
      await expectRun(page, "Pause");
      await closeTxOverlay(page);
      await beat(page);
      await paused.click();
      await expectRun(page, "Unpause");
      await beat(page, 2500);
    },
    { as: "creator" },
  );
});

test("10 autopilot: the agent reviews the index on its own", async ({ browser }) => {
  await scene(
    browser,
    "10-autopilot",
    async (page) => {
      await page.goto("/agents");
      const row = page.getByTestId("my-agent").first();
      await expect(row).toBeVisible();
      const ap = row.getByTestId("autopilot");
      await ap.scrollIntoViewIfNeeded();
      await beat(page, 2000);
      const toggle = row.getByTestId("autopilot-toggle");
      test.skip(await toggle.isDisabled(), "autopilot not available on this stack (no LLM key)");
      await row.getByTestId("autopilot-strategy").click();
      await page.keyboard.type(
        "Keep weights close to target. Rebalance only when drift passes the trigger and explain it in one post. Never change fees.",
        { delay: 15 },
      );
      await row.getByRole("button", { name: "Save strategy" }).click();
      await beat(page);
      await toggle.click();
      await beat(page, 1500);
      await row.getByTestId("autopilot-run").click();
      await beat(page, 2000);
      // The worker picks the run up within a minute; the log updates live.
      await expect
        .poll(
          async () =>
            (await ap.getByLabel("Running").count()) === 0 && (await ap.locator("li").count()) > 0,
          {
            timeout: 300_000,
            intervals: [5_000],
          },
        )
        .toBe(true);
      await beat(page, 5000);
    },
    { as: "creator" },
  );
});

test("11 an AI assistant prepares, the user signs (MCP)", async ({ browser }) => {
  const text = await mcpTool("build_create_index", {
    name: "Robotics Basket",
    symbol: "ROBO",
    assets: [
      { symbol: "TSLAx", weightPct: 40 },
      { symbol: "NVDAx", weightPct: 35 },
      { symbol: "GOOGLx", weightPct: 25 },
    ],
    depositUsdc: 50,
  });
  const signUrl = /https?:\/\/\S+\/sign\?id=[\w-]+/.exec(text)?.[0] as string;
  expect(signUrl).toBeTruthy();
  await scene(
    browser,
    "11-mcp-sign",
    async (page) => {
      const u = new URL(signUrl);
      await page.goto(`${u.pathname}${u.search}`);
      await beat(page, 3000);
      await page.getByTestId("intent-sign").click();
      await expect(page.getByText("Done. You can return to your agent.")).toBeVisible({
        timeout: 180_000,
      });
      await beat(page, 2500);
    },
    { as: "investor" },
  );
});

test("12 price moves, the keeper rebalances", async ({ browser }) => {
  await scene(browser, "12-keeper", async (page) => {
    await page.goto(indexPath);
    await page.waitForLoadState("networkidle");
    await beat(page);
    const rebalances = () => page.getByText(/^Rebalanced/).count();
    const before = await rebalances();
    script("price", "--asset", "NVDAx", "--pct", "+30");
    try {
      // The keeper runs every 30 s; the activity list shows the rebalance when it lands.
      await expect
        .poll(
          async () => {
            await page.reload();
            await page.waitForLoadState("networkidle");
            return rebalances();
          },
          { timeout: 240_000, intervals: [10_000] },
        )
        .toBeGreaterThan(before);
      await page
        .getByText(/rebalanced|Rebalanced/)
        .first()
        .scrollIntoViewIfNeeded();
      await beat(page, 3000);
      await page.getByText("Allocation").first().scrollIntoViewIfNeeded();
      await beat(page, 3000);
    } finally {
      script("price", "--asset", "NVDAx", "--pct", `${(1 / 1.3 - 1) * 100}`);
    }
  });
});

test("13 IPO: the pre-IPO sleeve migrates", async ({ browser }) => {
  await scene(browser, "13-ipo", async (page) => {
    await page.goto(indexPath);
    await page.getByTestId("prestocks-panel").scrollIntoViewIfNeeded();
    await beat(page, 2500);
    script("ipo", "--asset", "ANTHRP-pre");
    await expect
      .poll(
        async () => {
          await page.reload();
          await page.waitForLoadState("networkidle");
          return page.getByText("ANTHRPx").count();
        },
        { timeout: 120_000, intervals: [5_000] },
      )
      .toBeGreaterThan(0);
    await page.getByText("ANTHRPx").first().scrollIntoViewIfNeeded();
    await beat(page, 2500);
    await page.getByRole("tab", { name: "Timeline" }).click();
    await beat(page, 3500);
  });
});

test("14 social: feed, like, comment, follow, leaderboard, profile", async ({ browser }) => {
  await scene(
    browser,
    "14-social",
    async (page) => {
      await page.goto("/feed");
      await page.getByTestId("tab-all").click();
      const post = page.getByTestId("post-card").filter({ hasText: "AINFRA" }).first();
      await expect(post).toBeVisible();
      await beat(page, 2000);
      await post.getByTestId("like-button").click();
      await beat(page);
      await post.getByTestId("comments-button").click();
      await post.getByTestId("comment-input").pressSequentially("In for the Anthropic sleeve.", {
        delay: 40,
      });
      await post.getByTestId("comment-submit").click();
      await expect(post.getByTestId("comment-list")).toContainText("Anthropic sleeve");
      await beat(page, 2000);
      await page.goto(indexPath);
      await page.getByRole("tab", { name: "Discussion" }).click();
      await beat(page, 2500);
      await page.locator('main a[href^="/u/"]').first().click();
      await expect(page).toHaveURL(/\/u\//);
      await page.getByTestId("follow").click();
      await expect(page.getByTestId("follow")).toHaveText("Following");
      await beat(page, 2000);
      await page.goto("/leaderboard");
      await beat(page, 3000);
      await smoothScroll(page, 600);
      await beat(page, 2000);
      await page.goto("/portfolio");
      await beat(page, 3000);
    },
    { as: "investor" },
  );
});

test("15 creator earnings", async ({ browser }) => {
  script("warp", "--days", "30");
  await scene(
    browser,
    "15-earnings",
    async (page) => {
      await page.goto(`${indexPath}/manage`);
      await beat(page, 2000);
      const claim = page.getByTestId("claim-creator");
      await claim.scrollIntoViewIfNeeded();
      await beat(page);
      await claim.click();
      await expectRun(page, "Claim creator fees");
      await beat(page, 2000);
      await page.goto("/portfolio");
      await beat(page, 2500);
      await smoothScroll(page, 600);
      await beat(page, 3000);
    },
    { as: "creator" },
  );
});

test.afterAll(() => {
  rmSync(path.join(OUT, ".raw"), { recursive: true, force: true });
});
