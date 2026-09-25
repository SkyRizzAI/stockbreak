/** Visual review captures (PLAN §8.8, A15). Only with E2E_VISUAL=1 (bun run e2e:visual). */
import { expect, type Page, test } from "@playwright/test";
import { connectDevWallet } from "./helpers";

test.skip(!process.env.E2E_VISUAL, "visual captures run via bun run e2e:visual");

const OUT = "visual";
let index = "";
let creator = "";

test.beforeAll(async ({ request }) => {
  const { items } = (await (await request.get("/api/indexes?limit=50")).json()) as {
    items: { pubkey: string; symbol: string; creator: string }[];
  };
  const m = items.find((i) => i.symbol === "MAG4") ?? items[0];
  index = m?.pubkey ?? "";
  creator = m?.creator ?? "";
});

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

for (const scheme of ["light", "dark"] as const)
  for (const width of [375, 1280])
    test.describe(`${scheme}-${width}`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 900 } });
      // Dark is the default whatever the OS says (D034); light is a stored choice.
      test.beforeEach(async ({ page }) => {
        await page.addInitScript((t) => {
          try {
            localStorage.setItem("stocklana:theme", t);
          } catch {
            // storage unavailable
          }
        }, scheme);
      });
      const tag = `${scheme}-${width}`;

      test("pages", async ({ page }) => {
        const pages: [string, string][] = [
          ["home", "/"],
          ["explore", "/explore"],
          ["index", `/i/${index}`],
          ["leaderboard", "/leaderboard"],
          ["profile", `/u/${creator}`],
          ["create", "/create"],
          ["portfolio-empty", "/portfolio"],
          ["faucet", "/faucet"],
          ["agents", "/agents"],
          ["feed", "/feed"],
          ["sign-missing", "/sign?id=00000000-0000-0000-0000-000000000000"],
          ["not-found", "/i/11111111111111111111111111111111"],
        ];
        for (const [name, url] of pages) {
          await page.goto(url);
          await shot(page, `${tag}-${name}`);
        }
      });

      test("connected states", async ({ page }) => {
        await page.goto("/");
        await connectDevWallet(page);
        await page.goto(`/i/${index}`);
        await shot(page, `${tag}-index-connected`);
        await page.goto("/create");
        await page.getByTestId("asset-NVDAx").click();
        await page.getByTestId("asset-AAPLx").click();
        await page.getByTestId("asset-OPENAI-pre").click();
        await shot(page, `${tag}-create-1-assets`);
        for (const step of ["2-weights", "3-strategy", "4-fees", "5-review"]) {
          await page.getByTestId("wizard-next").click();
          await shot(page, `${tag}-create-${step}`);
        }
        await page.goto("/portfolio");
        await shot(page, `${tag}-portfolio-connected`);
        await page.goto("/feed");
        await page.getByTestId("tab-all").click();
        await page.getByTestId("comments-button").first().click();
        await shot(page, `${tag}-feed-connected`);
        await expect(page.locator("main")).toBeVisible();
      });
    });
