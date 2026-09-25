/**
 * Demo recording for the pitch video (docs/SUBMISSION.md). Only with E2E_DEMO=1
 * (`bun run demo:record`). Each scene is saved as its own 1280×720 clip in
 * e2e/demo/ so it can be trimmed and narrated. Runs on a fresh localnet stack.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { connectDevWallet, expectRun, finishWizard } from "./helpers";

test.skip(!process.env.E2E_DEMO, "demo recording runs via bun run demo:record");
test.describe.configure({ mode: "serial" });
test.setTimeout(900_000);

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "e2e/demo");
const STATE = path.join(ROOT, "e2e/.stack/demo-creator.json");
const MCP_URL = process.env.E2E_MCP_URL ?? "http://127.0.0.1:3333/mcp";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const SIZE = { width: 1280, height: 720 };
let indexPath = "";

const script = (name: string, ...args: string[]) =>
  execFileSync("bun", ["run", name, "--", ...args], { cwd: ROOT, encoding: "utf8" });
const beat = (page: Page, ms = 1500) => page.waitForTimeout(ms);

/** One recorded scene: fresh context (optionally as the creator), video saved as `name`. */
async function scene(
  browser: Browser,
  name: string,
  body: (page: Page) => Promise<void>,
  opts: { asCreator?: boolean; saveCreator?: boolean } = {},
) {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: SIZE,
    recordVideo: { dir: path.join(OUT, ".raw"), size: SIZE },
    storageState: opts.asCreator ? STATE : undefined,
  });
  const page = await context.newPage();
  try {
    await body(page);
    if (opts.saveCreator) await context.storageState({ path: STATE });
  } finally {
    await page.close();
    await page.video()?.saveAs(path.join(OUT, `${name}.webm`));
    await context.close();
  }
}

async function smoothScroll(page: Page, px: number, steps = 12) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await page.waitForTimeout(90);
  }
}

test.beforeAll(() => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
});

test("01 markets", async ({ browser }) => {
  await scene(browser, "01-markets", async (page) => {
    await page.goto("/");
    await beat(page, 2500);
    await smoothScroll(page, 900);
    await beat(page);
    await smoothScroll(page, -900);
    await page
      .getByRole("link", { name: /Magnificent Four/ })
      .first()
      .click();
    await expect(page.getByTestId("prestocks-panel")).toBeVisible();
    await beat(page);
    await page.getByTestId("prestocks-panel").scrollIntoViewIfNeeded();
    await beat(page, 3000);
  });
});

test("02 create an index", async ({ browser }) => {
  await scene(
    browser,
    "02-create",
    async (page) => {
      await page.goto("/create");
      await connectDevWallet(page);
      await beat(page);
      for (const s of ["NVDAx", "MSFTx", "ANTHRP-pre"]) {
        await page.getByTestId(`asset-${s}`).click();
        await beat(page, 600);
      }
      await page.getByTestId("wizard-next").click();
      await beat(page, 2000);
      indexPath = await finishWizard(page, {
        name: "AI Infra + Anthropic",
        symbol: "AINFRA",
        deposit: "2000",
      });
      await expect(page.getByRole("heading", { name: "AI Infra + Anthropic" })).toBeVisible();
      await beat(page, 3000);
    },
    { saveCreator: true },
  );
});

test("03 share as a card", async ({ browser }) => {
  await scene(
    browser,
    "03-share",
    async (page) => {
      await page.goto(indexPath);
      await beat(page);
      await page.getByRole("button", { name: "Share" }).click();
      await beat(page, 800);
      await page.getByTestId("share-to-feed").click();
      await expect(page.getByTestId("share-preview")).toBeVisible();
      await beat(page);
      for (const v of ["tokens", "chart", "mark"]) {
        await page.getByTestId(`card-variant-${v}`).click();
        await beat(page, 1200);
      }
      await page.getByTestId("card-variant-tokens").click();
      await page
        .getByTestId("post-input")
        .pressSequentially("AI infra + a PreStocks Anthropic sleeve. Rebalances on 5% drift.", {
          delay: 25,
        });
      await page.getByTestId("post-submit").click();
      await page.getByTestId("tab-all").click();
      await expect(page.getByTestId("post-card").first()).toContainText("AINFRA");
      await beat(page, 3000);
    },
    { asCreator: true },
  );
});

test("04 someone joins", async ({ browser }) => {
  await scene(browser, "04-join", async (page) => {
    await page.goto(indexPath);
    await connectDevWallet(page);
    await beat(page);
    await page.getByTestId("join-amount").fill("");
    await page.getByTestId("join-amount").pressSequentially("100", { delay: 120 });
    await beat(page);
    await page.getByTestId("join-submit").click();
    await expectRun(page, /Joined AINFRA/);
    await beat(page, 3000);
  });
});

test("05 price moves, the keeper rebalances", async ({ browser }) => {
  await scene(browser, "05-keeper", async (page) => {
    await page.goto(indexPath);
    await beat(page);
    script("price", "--asset", "NVDAx", "--pct", "+30");
    try {
      // The keeper runs every 30 s; the activity list shows the rebalance when it lands.
      await expect
        .poll(
          async () => {
            await page.reload();
            // Index data and activity load after the page: count once they arrived.
            await page.waitForLoadState("networkidle");
            return page.getByText(/rebalanced|Rebalanced/).count();
          },
          { timeout: 240_000, intervals: [10_000] },
        )
        .toBeGreaterThan(0);
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

test("06 IPO: the sleeve migrates", async ({ browser }) => {
  await scene(browser, "06-ipo", async (page) => {
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
    await beat(page, 3500);
  });
});

test("07 an AI agent builds an index", async ({ browser }) => {
  const c = new Client({ name: "demo", version: "1" }, { versionNegotiation: { mode: "auto" } });
  await c.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  const r = (await c.callTool({
    name: "build_create_index",
    arguments: {
      name: "Robotics Basket",
      symbol: "ROBO",
      assets: [
        { symbol: "TSLAx", weightPct: 40 },
        { symbol: "NVDAx", weightPct: 35 },
        { symbol: "GOOGLx", weightPct: 25 },
      ],
      depositUsdc: 50,
    },
  })) as { content: { text: string }[] };
  await c.close();
  const text = r.content.map((x) => x.text).join("\n");
  const signUrl = /https?:\/\/\S+\/sign\?id=[\w-]+/.exec(text)?.[0] as string;
  expect(signUrl).toBeTruthy();
  await scene(browser, "07-agent", async (page) => {
    const u = new URL(signUrl);
    await page.goto(`${u.pathname}${u.search}`);
    await beat(page, 2500);
    await connectDevWallet(page);
    await page.getByTestId("intent-sign").click();
    await expect(page.getByText("Done. You can return to your agent.")).toBeVisible({
      timeout: 180_000,
    });
    await beat(page, 1500);
    await page.goto("/leaderboard");
    await beat(page, 3500);
  });
});

test("08 creator earnings", async ({ browser }) => {
  script("warp", "--days", "30");
  await scene(
    browser,
    "08-portfolio",
    async (page) => {
      await page.goto("/portfolio");
      await beat(page, 2500);
      await smoothScroll(page, 600);
      await beat(page, 3000);
    },
    { asCreator: true },
  );
});

test.afterAll(() => {
  rmSync(path.join(OUT, ".raw"), { recursive: true, force: true });
});
